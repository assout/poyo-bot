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
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'AVAILABLE' },
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
    const begin = new Date();
    begin.setDate(begin.getDate() - 7);
    const param = {
      TableName: 'images',
      FilterExpression: 'registeredTime > :begin',
      ExpressionAttributeValues: {
        ':begin': begin.getTime(),
      },
    };
    console.log(begin.getTime());

    const result = docClient.scan(param, (err, data) => {
      if (err) {
        console.log(err);
        reject(err);
      }
    });

    result.on('success', (response) => {
      response.data.Items.sort((a, b) => {
        if (a.registeredTime > b.registeredTime) return 1;
        if (a.registeredTime < b.registeredTime) return -1;
        return 0;
      });
      resolve(response.data.Items);
    });
  });
}

function delivery(values) {
  return new Promise((resolve, reject) => {
    const mids = values[0];
    const images = values[1];

    console.log(mids);
    console.log(images);

    const messages = [];
    images.forEach((image) => {
      messages.push(
        {
          contentType: 2,
          originalContentUrl: image.bucket,
          previewImageUrl: image.bucket,
        }
      );
      const comment = image.comment;
      if (typeof comment !== 'undefined') {
        messages.push(
          {
            contentType: 1,
            text: comment,
          }
        );
      }
    });

    messages.push({
      contentType: 1,
      text: messages.length === 0 ? '今週は進捗ないぽよ〜' : '様子ぽよ',
    });

    console.log(messages);
    console.log(JSON.stringify(messages));

    // TODO メッセージ数APIの制限ある？
    const data = JSON.stringify({
      to: mids,
      toChannel: 1383378250,
      eventType: '140177271400161403',
      content: {
        messages,
      },
    });

    send(data);
  });
}

function send(data) {
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
}

exports.handler = function (event, context) {
  console.log(`Received event: ${JSON.stringify(event, null, '  ')}`);

  const friendsPromise = scanFriends(event, context);
  const imagesPromise = scanImages(event, context);

  Promise.all([friendsPromise, imagesPromise])
    .then(delivery)
    .then((result) => {
      context.done();
    }, (err) => {
      console.log(`errrrrr: ${err}`);
      context.done();
    });
};
