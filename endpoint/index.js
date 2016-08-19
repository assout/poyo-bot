'use strict';

const aws = require('aws-sdk');
aws.config.update({
  region: 'ap-northeast-1',
});

const s3 = new aws.S3({ apiVersion: '2006-03-01' });
const docClient = new aws.DynamoDB.DocumentClient();
const https = require('https');
const async = require('async');
const request = require('request');

const bucket = 'assout-images';
const endpointHost = 'trialbot-api.line.me';
const headers = {
  'Content-Type': 'application/json; charset=UTF-8',  // Fixed value
  'X-Line-ChannelID': process.env.LINE_CHANNEL_ID,
  'X-Line-ChannelSecret': process.env.LINE_CHANNEL_SECRET,
  'X-Line-Trusted-User-With-ACL': process.env.LINE_CHANNEL_MID,
};

function getResult(comment) {
  console.log(`do scan! comment:${comment}`);

  let param;
  if (comment === null) {
    param = { TableName: 'images' };
  } else {
    param = {
      TableName: 'images',
      FilterExpression: 'contains(#comment, :comment)',
      ExpressionAttributeNames: { '#comment': 'comment' },
      ExpressionAttributeValues: { ':comment': comment },
    };
  }

  return docClient.scan(param, (err, data) => {
    if (err) {
      console.log(err); // エラー時
    } else {
      data.Items.forEach((item) => {
        console.log(item);
      });
    }
  });
}

function increment(bucketName) {
  const params = {
    TableName: 'images',
    Key: { bucket: bucketName },
    UpdateExpression: 'set #referenceTime = :i',
    ExpressionAttributeNames: { '#referenceTime': 'referenceTime' },
    ExpressionAttributeValues: { ':i': new Date().getTime() },
  };

  docClient.update(params, (err, data) => {
    if (err) {
      console.log(`error: ${err}`);
    } else {
      console.log(`success: ${data}`);
    }
  });
}

function send(data) {
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


function doResponse(msg) {
  const result = getResult(msg.content.text);
  result.on('success', (response) => {
    console.log('Success!');
    console.log(response);

    const items = response.data.Items;
    let data;
    if (items.length === 0) {
      data = JSON.stringify({
        to: [msg.content.from.toString()],
        toChannel: 1383378250,
        eventType: '138311608800106203',
        content: {
          contentType: 1,
          toType: 1,
          text: `${msg.content.text}って何だぽよ〜`,
        },
      });
    } else {
      const referenceTimeMap = response.data.Items.map(o => o.referenceTime);
      const min = Math.min.apply(null, referenceTimeMap);
      const index = referenceTimeMap.indexOf(min);

      const item = response.data.Items[index];
      const messages = [
        {
          contentType: 2,
          originalContentUrl: item.bucket,
          previewImageUrl: item.bucket,
        },
      ];
      const comment = item.comment;
      if (typeof comment !== 'undefined') {
        messages.push(
          {
            contentType: 1,
            text: comment,
          }
        );
      }

      data = JSON.stringify({
        to: [msg.content.from.toString()],
        toChannel: 1383378250,
        eventType: '140177271400161403',
        content: {
          messages,
        },
      });

      increment(item.bucket);
    }
    send(data);
  });
}

function receiveText(msg) {
  doResponse(msg);
}

function receiveStikcer(msg) {
  doResponse(msg);
}

function retriveImageFrom(contentId, callback) {
  const options = {
    hostname: endpointHost,
    path: `/v1/bot/message/${contentId}/content`,
    headers,
    method: 'GET',
  };
  const req = https.request(options, (res) => {
    const data = [];
    res.on('data', (chunk) => {
      // image data dividing it in to multiple request
      data.push(new Buffer(chunk));
    }).on('error', (err) => {
      console.log(err);
    }).on('end', () => {
      console.log('finish to retrive image');
      const img = Buffer.concat(data);
      callback(null, img);
    });
  });

  req.end();
}

function saveImageToS3(img, name, callback) {
  const params = {
    Bucket: bucket,
    Key: name,
    ACL: 'public-read',
    Body: img,
  };
  s3.putObject(params, (err, data) => {
    if (err) {
      console.log(err);
      callback('e', '');
    } else {
      callback(null, name);
    }
  });
}

function receiveImage(msg) {
  async.waterfall([
    function (callback) {
      retriveImageFrom(msg.content.id, callback);
    },
    function (img, callback) {
      async.parallel({
        original(callback) {
          saveImageToS3(img, `${msg.content.id}.jpg`, callback);
        },
      }, (err, result) => {
        if (err) {
          console.log(err);
        } else {
          callback(null, result.original);
        }
      });
    },
    function (originalUrl, callback) {
      console.log(originalUrl);
      const data = JSON.stringify({
        to: [msg.content.from.toString()],
        toChannel: 1383378250,
        eventType: '138311608800106203',
        content: {
          contentType: 1,
          toType: 1,
          text: '登録したぽよ',
        },
      });
      send(data);
    },
  ], (err, result) => {
    if (err) {
      console.log(err);
    }
  });
}

function addFriends(result) {
  const receiveOptions = {
    url: `https://trialbot-api.line.me/v1/profiles?mids=${result.content.params[0]}`,
    headers,
    json: true,
  };
  request.get(receiveOptions, (error, response, body) => {
    if (error) {
      console.log(`error:${JSON.stringify(error)}`);
    } else {
      console.log("test: " + body);
      const usermid = body.contacts[0].mid;
      const username = body.contacts[0].displayName;
      docClient.put({
        TableName: 'friends',
        Item: {
          mid: usermid,
          username,
        },
      }, (err, data) => {
        if (err) {
          console.log(err);
        } else {
          console.log(`add friends successfully, ${data}`);
        }
      });
    }
  });
}

function proc(result) {
  if (result.content.opType === 4) {
    addFriends(result);
  } else if (result.content.contentType === 1) {
    receiveText(result);
  } else if (result.content.contentType === 2) {
    receiveImage(result);
  } else if (result.content.contentType === 8) {
    receiveStikcer(result);
  }
}

exports.lambdaHandler = function main(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2));
  event.result.forEach((result) => {
    proc(result);
  });
};

