"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const os_1 = require("os");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const AWS = require("aws-sdk");
const moment = require("moment");
const MongodbURI = require("mongodb-uri");
const PROJECT_ROOT = process.mainModule.paths[0].split("node_modules")[0];
const localBackupFolderName = 'backups';
const currentTime = (timezoneOffset = 0) => moment().utcOffset(timezoneOffset).format("YYYY-MM-DDTHH-mm-ss");
const getFileName = (database, timezoneOffset) => `${database}_${currentTime(timezoneOffset)}.gz`;
const getBackUpPath = (config) => {
    if (config.keepLocalBackups)
        return path.resolve(PROJECT_ROOT, localBackupFolderName);
    return path.resolve(os_1.tmpdir());
};
const isValidConfig = (config) => {
    if (config && config.mongodb && config.s3 && config.s3.accessKey && config.s3.secretKey && config.s3.region && config.s3.bucketName) {
        if (typeof config.mongodb !== 'string') {
            if (config.mongodb.database && config.mongodb.host && config.mongodb.port)
                return true;
            return false;
        }
        return true;
    }
    return false;
};
const getMongodbConnectionInstance = (config) => {
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
const cleanFs = (config, fullFilePath, backUpPath) => {
    if (!config.keepLocalBackups) {
        fs_1.unlinkSync(fullFilePath);
    }
    else {
        if (config.noOfLocalBackups) {
            let oldBackupNames = fs_1.readdirSync(backUpPath)
                .filter(dirItem => fs_1.lstatSync(path.resolve(backUpPath, dirItem)).isFile())
                .reverse()
                .slice(config.noOfLocalBackups);
            oldBackupNames.forEach(fileName => fs_1.unlinkSync(path.resolve(backUpPath, fileName)));
        }
        Promise.resolve();
    }
};
const createS3Instance = (s3Config) => {
    AWS.config.update({
        accessKeyId: s3Config.accessKey,
        secretAccessKey: s3Config.secretKey,
        region: s3Config.region
    });
    const s3Instance = new AWS.S3();
    return {
        uploadFile: (fullFilePath, fileName) => {
            return new Promise((resolve, reject) => {
                const fileStream = fs_1.createReadStream(fullFilePath);
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
                s3Instance.createBucket(bucketParams, () => s3Instance.upload(uploadParams, (err, data) => {
                    if (err)
                        return reject(err);
                    resolve();
                }));
            });
        }
    };
};
const prepareFolderStructure = (config) => {
    if (config.keepLocalBackups) {
        const localFolder = path.resolve(PROJECT_ROOT, localBackupFolderName);
        if (!fs_1.existsSync(localFolder))
            fs_1.mkdirSync(localFolder);
    }
};
function createBackup(mongodb, fullFilePath) {
    return new Promise((resolve, reject) => {
        const database = mongodb.database, password = mongodb.password || null, username = mongodb.username || null, host = mongodb.hosts[0].host || null, port = mongodb.hosts[0].port || null, ssl = mongodb.ssl || null, authenticationDatabase = mongodb.authenticationDatabase || null;
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
        if (ssl)
            command += ` --ssl`;
        if (authenticationDatabase)
            command += ` --authenticationDatabase=${authenticationDatabase}`;
        child_process_1.exec(command, (err) => {
            if (err)
                return reject(err);
            return resolve();
        });
    });
}
const backupAndUpload = (config) => {
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
//# sourceMappingURL=index.js.map