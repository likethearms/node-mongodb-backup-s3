const backup = require('../index');
var backupConfig = {
  mongodb: "mongodb://localhost:27017/foobar", // MongoDB Connection URI
  s3: {
    accessKey: "",  //AccessKey
    secretKey: "",  //SecretKey
    region: "",
    bucketName: "" //Bucket Name
  },
  keepLocalBackups: true,  //If true, It'll create a folder in project root with database's name and store backups in it and if it's false, It'll use temporary directory of OS
  noOfLocalBackups: 4, //This will only keep the most recent 5 backups and delete all older backups from local backup directory
  timezoneOffset: 300 //Timezone, It is assumed to be in hours if less than 16 and in minutes otherwise
}
backup(backupConfig);
