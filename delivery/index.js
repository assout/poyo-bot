'use strict';

const aws = require('aws-sdk');
aws.config.update({
  region: 'ap-northeast-1',
});
const docClient = new aws.DynamoDB.DocumentClient();
const https = require('https');

function scanFriends(event, context) {
  return new Promise((resolve, reject) => {
    const param = {
      TableName: 'friends',
    };

    const result = docClient.scan(param, (err, data) => {
      if (err) {
        console.log(err);
        reject(err);
      }
    });

    result.on('success', (response) => {
      const friends = response.data.Items;
      const mids = friends.map(o => o.mid);
      resolve(mids);
    });
  });
}

function scanImages(event, context) {
  return new Promise((resolve, reject) => {
    const param = {
      TableName: 'images',
    };

    const result = docClient.scan(param, (err, data) => {
      if (err) {
        console.log(err);
        reject(err);
      }
    });

    result.on('success', (response) => {
      const countMap = response.data.Items.map(o => o.referenceCount);
      const min = Math.min.apply(null, countMap);
      const index = countMap.indexOf(min);
      const item = response.data.Items[index];
      resolve(item);
    });
  });
}

function increment(bucket, resolve, reject) {
  const params = {
    TableName: 'images',
    Key: { bucket },
    UpdateExpression: 'set #referenceCount = #referenceCount + :i',
    ExpressionAttributeNames: { '#referenceCount': 'referenceCount' },
    ExpressionAttributeValues: { ':i': 1 },
  };

  docClient.update(params, function (err, data) {
    if (err) {
      console.log(`error: ${err}`);
      reject(err);
    } else {
      resolve();
    }
  });
}

function delivery(values) {
  return new Promise((resolve, reject) => {

    const mids = values[0];
    const image = values[1];

    console.log(mids);
    console.log(image);

    const messages = [
      {
        contentType: 2,
        originalContentUrl: image.bucket,
        previewImageUrl: image.bucket,
      },
    ];

    const comment = image.comment;
    if (typeof comment !== 'undefined') {
      messages.push(
        {
          contentType: 1,
          text: comment,
        }
      );
    }

    const data = JSON.stringify({
      to: mids,
      toChannel: 1383378250,
      eventType: '140177271400161403',
      content: {
        messages,
      },
    });

    send(data);

    increment(image.bucket, resolve, reject);

    console.log("debubbbbbbbbbbbb");
  });
}

function send(data) {
  console.log('do send. ' + data);
  console.log(process.env);
  const opts = {
    host: 'trialbot-api.line.me',
    path: '/v1/events',
    headers: {
      'Content-type': 'application/json; charset=UTF-8',
      'X-Line-ChannelID': process.env.LINE_CHANNEL_ID,
      'X-Line-ChannelSecret': process.env.LINE_CHANNEL_SECRET,
      'X-Line-Trusted-User-With-ACL': process.env.LINE_CHANNEL_MID,
    },
    method: 'POST',
  };

  const req = https.request(opts, (res) => {
    res.on('data', (chunk) => {
      console.log(chunk.toString());
    }).on('error', (e) => {
      console.log(`ERROR:${e.stack}`);
    });
  });
  req.write(data);
  req.end();
  console.log('end send. ' + data);
}

exports.handler = function (event, context) {
  console.log('Received event:' + JSON.stringify(event, null, '  '));

  const friendsPromise = scanFriends(event, context);
  const imagesPromise = scanImages(event, context);

  Promise.all([friendsPromise, imagesPromise])
    .then(delivery)
    .then(function(result) {
      context.done();
    }, function(err) {
      console.log("errrrrr: " + err);
      context.done();
    });
};
