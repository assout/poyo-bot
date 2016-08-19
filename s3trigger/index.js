'use strict';

const aws = require('aws-sdk');
aws.config.update({
  region: 'ap-northeast-1',
});
const docClient = new aws.DynamoDB.DocumentClient();
const s3 = new aws.S3({ apiVersion: '2006-03-01' });
const im = require('imagemagick');

function registrationMetadata(event, context) {
  // Get the object from the event and show its content type
  const bucket = event.Records[0].s3.bucket.name;
  const key = event.Records[0].s3.object.key;
  const size = String(event.Records[0].s3.object.size);
  const eventName = event.Records[0].eventName;
  const eventTime = event.Records[0].eventTime;
  const sourceIp = event.Records[0].requestParameters.sourceIPAddress;
  docClient.put({
    TableName: 'images',
    Item: {
      bucket: `https://s3-ap-northeast-1.amazonaws.com/${bucket}/${key}`,
      referenceTime: 0,
      size,
      eventName,
      eventTime,
      sourceIp,
    },
  }, function (err, data) {
    if (err) {
      console.log(err);
    } else {
      console.log('data uploaded successfully,' + data);
      context.done();
    }
  });
}

function createThumbnail(event, context) {
  const bucket = event.Records[0].s3.bucket.name;
  const key = event.Records[0].s3.object.key;

  s3.getObject({
    Bucket: bucket,
    Key: key,
    IfMatch: event.Records[0].s3.object.eTag,
  }, function (err, data) {
    if (err) {
      console.log(err);
      context.done('error getting object', err);
    } else {
      console.log(data);

      const contentType = data.ContentType;
      const extension = contentType.split('/').pop();

      im.resize({
        srcData: data.Body,
        format: extension,
        width: 64,
      }, function (err, stdout, stderr) {
        if (err) {
          console.log(err);
          context.done('resize failed', err);
        } else {
          const thumbnailBucket = bucket + '-thumbnail';
          const thumbnailKey = key.split('.')[0] + '-thumbnail.' + extension;

          s3.putObject({
            Bucket: thumbnailBucket,
            Key: thumbnailKey,
            Body: new Buffer(stdout, 'binary'),
            ContentType: contentType,
          }, function (err, res) {
            if (err) {
              console.log(err);
            } else {
              console.log(JSON.stringify(res, null, 2));
              registrationMetadata(event, context);
            }
          });
        }
      });
    }
  });
}

exports.handler = function (event, context) {
  console.log('Received event:');
  console.log(JSON.stringify(event, null, '  '));
  console.log(JSON.stringify(context, null, 2));
  // createThumbnail(event, context);
  registrationMetadata(event, context);
};

