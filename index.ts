import * as path from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { existsSync, mkdirSync, createReadStream, unlinkSync, readdirSync, lstatSync } from 'fs';
import * as AWS from 'aws-sdk';
import * as moment from 'moment';
import * as MongodbURI from 'mongodb-uri';

interface MongoDBConfig {
  database: string;
  host: string;
  username: string;
  password: string;
  port: number;
  ssl: boolean;
  authenticationDatabase: string;
}

interface MongoDBInstance {
  scheme: string;
  username: string | null;
  password: string | null;
  database: string;
  ssl: boolean;
  authenticationDatabase: string;
  hosts: [{
    host: string;
    port: number;
  }]
}

interface S3Config {
  accessKey: string;
  secretKey: string;
  region: string;
  accessPerm: string;
  bucketName: string;
}

interface Config {
  keepLocalBackups: boolean;
  noOfLocalBackups: number;
  timezoneOffset: number;
  mongodb: MongoDBConfig | string;
  s3: S3Config;
}

const PROJECT_ROOT = process.mainModule.paths[0].split("node_modules")[0];
const localBackupFolderName = 'backups';

const currentTime = (timezoneOffset: number = 0): string => moment().utcOffset(timezoneOffset).format("YYYY-MM-DDTHH-mm-ss");

const getFileName = (database: string, timezoneOffset: number): string => `${database}_${currentTime(timezoneOffset)}.gz`;

const getBackUpPath = (config: Config): string => {
  if (config.keepLocalBackups) return path.resolve(PROJECT_ROOT, localBackupFolderName);
  return path.resolve(tmpdir());
};

const isValidConfig = (config: Config): boolean => {
  if (config && config.mongodb && config.s3 && config.s3.accessKey && config.s3.secretKey && config.s3.region && config.s3.bucketName) {
    if (typeof config.mongodb !== 'string') {
      if (config.mongodb.database && config.mongodb.host && config.mongodb.port) return true
      return false;
    }
    return true;
  }
  return false;
}

const getMongodbConnectionInstance = (config: Config): MongoDBInstance => {
  if (typeof config.mongodb == "string") {
    return MongodbURI.parse(config.mongodb);
  }
  return {
    scheme: 'mongodb',
    username: config.mongodb.username || null,
    password: config.mongodb.password || null,
    database: config.mongodb.database,
    ssl: config.mongodb.ssl,
    authenticationDatabase: config.mongodb.authenticationDatabase,
    hosts: [{
      host: config.mongodb.host,
      port: config.mongodb.port
    }]
  };
};

const cleanFs = (config: Config, fullFilePath: string, backUpPath: string) => {
  if (!config.keepLocalBackups) {
    unlinkSync(fullFilePath);
  } else {
    if (config.noOfLocalBackups) {
      let oldBackupNames = readdirSync(backUpPath)
        .filter(dirItem => lstatSync(path.resolve(backUpPath, dirItem)).isFile())
        .reverse()
        .slice(config.noOfLocalBackups);

      oldBackupNames.forEach(fileName => unlinkSync(path.resolve(backUpPath, fileName)));
    }
    Promise.resolve();
  }
}

const createS3Instance = (s3Config: S3Config) => {
  AWS.config.update({
    accessKeyId: s3Config.accessKey,
    secretAccessKey: s3Config.secretKey,
    region: s3Config.region
  });
  const s3Instance = new AWS.S3();

  return {
    uploadFile: (fullFilePath: string, fileName: string) => {
      return new Promise((resolve, reject) => {
        const fileStream = createReadStream(fullFilePath);
        fileStream.on('error', reject);

        const uploadParams = {
          Bucket: s3Config.bucketName,
          Key: fileName,
          Body: fileStream
        };

        const bucketParams = {
          Bucket: s3Config.bucketName,
          ACL: s3Config.accessPerm || "private",
          CreateBucketConfiguration: {
            LocationConstraint: s3Config.region
          }
        };

        s3Instance.createBucket(bucketParams, () =>
          s3Instance.upload(uploadParams, (err, data) => {
            if (err) return reject(err);
            resolve();
          }));
      })
    }
  }
}

const prepareFolderStructure = (config: Config) => {
  if (config.keepLocalBackups) {
    const localFolder = path.resolve(PROJECT_ROOT, localBackupFolderName);
    if (!existsSync(localFolder)) mkdirSync(localFolder);
  }
}

function createBackup(mongodb: MongoDBInstance, fullFilePath: string) {
  return new Promise((resolve, reject) => {
    const database = mongodb.database,
      password = mongodb.password || null,
      username = mongodb.username || null,
      host = mongodb.hosts[0].host || null,
      port = mongodb.hosts[0].port || null,
      ssl = mongodb.ssl || null,
      authenticationDatabase = mongodb.authenticationDatabase || null;

    // Default command, does not considers username or password
    let command = `mongodump -h ${host} --port=${port} -d ${database} --quiet --gzip --archive=${fullFilePath}`;

    // When Username and password is provided
    if (username && password) {
      command = `mongodump -h ${host} --port=${port} -d ${database} -p ${password} -u ${username} --quiet --gzip --archive=${fullFilePath}`;
    }
    // When Username is provided
    if (username && !password) {
      command = `mongodump -h ${host} --port=${port} -d ${database} -u ${username} --quiet --gzip --archive=${fullFilePath}`;
    }

    if (ssl) command += ` --ssl`;
    if (authenticationDatabase) command += ` --authenticationDatabase=${authenticationDatabase}`;

    exec(command, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
}

const backupAndUpload = (config: Config) => {
  if (isValidConfig(config)) {
    const mongoConnectionInstance = getMongodbConnectionInstance(config);
    const backUpPath = getBackUpPath(config);
    const fileName = getFileName(mongoConnectionInstance.database, config.timezoneOffset);
    const fullFilePath = path.resolve(backUpPath, fileName);
    const s3 = createS3Instance(config.s3);
    prepareFolderStructure(config);
    return createBackup(mongoConnectionInstance, fullFilePath)
      .then(() => s3.uploadFile(fullFilePath, fileName))
      .then(() => cleanFs(config, fullFilePath, backUpPath));
  }
  return Promise.reject('Invalid Configuration');
};

module.exports = backupAndUpload;
