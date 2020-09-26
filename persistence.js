require('dotenv').config();
const AWS = require('aws-sdk');
const express = require('express');
const responseTime = require('response-time')
const axios = require('axios');
const redis = require('redis');
const app = express();

// create unique bucket name
const bucketName = 'john-y-qut-wikibuket';
// create redisClient
const redisClient = redis.createClient();
// check redis works
redisClient.on('error', (err) => {
    console.log("Error Reids");
});
// time
app.use(responseTime());

const bucketPromise = new AWS.S3({
    apiVersion: '2006-03-01'
}).createBucket({
    Bucket: bucketName
}).promise();

// try to make the bucket
bucketPromise.then(function (data) {
        console.log("Successfully created " + bucketName);
    })
    .catch(function (error) {
        console.log("Bucket Creation Error!");
        console.log(error, error.stack);
    });

// route for storing articles in the buckets
app.get('/api/store', (req, res) => {
    // what was searched
    const key = (req.query.key).trim();
    console.log(req.query);

    // Construct the wiki URL and the key
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
    const searchingKey = `wikipedia-${key}`;

    const params = {
        Bucket: bucketName,
        Key: searchingKey
    };
    // try to return from S3
    return new AWS.S3({
            apiVersion: '2006-03-01'
        })
        .getObject(params, (err, result) => {
            if (result) {
                console.log("found in s3");
                // get from S3         
                console.log(result);
                const resultJSON = JSON.parse(result.Body);
                return res.status(200).json(resultJSON);

            } else {
                // Get from wikipedia, store in S3      
                return axios.get(searchUrl)
                    .then(response => {
                        console.log("returning response");
                        const responseJSON = response.data;
                        const body = JSON.stringify({
                            source: 'S3 Bucket',
                            ...responseJSON
                        });
                        const objectParams = {
                            Bucket: bucketName,
                            Key: searchingKey,
                            Body: body
                        };
                        const uploadPromise = new AWS.S3({
                                apiVersion: '2006-03-01'
                            })
                            .putObject(objectParams).promise();
                        uploadPromise.then(function (data) {
                            console.log("Successfully uploaded data to " 
                            + bucketName + "/" + searchingKey);
                        });

                        return res.status(200).json({
                            source: 'Wikipedia API',
                            ...responseJSON,
                        });
                    }).catch(err => {
                        console.log("Something went wrong");
                        return res.json(err);
                    });
            }
        });
})

// search for a term, which checks redis then S3 then wikipedia
app.get('/api/search', (req, res) => {
    const key = (req.query.key).trim();

    // Construct the wiki URL and S3 key
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
    const searchingKey = `wikipedia-${key}`;

    // First check redis cache
    return redisClient.get(searchingKey, (err, result) => {
        console.log("Trying Redis Cache");

        if (result) {
            // Serve from Cache
            console.log("Success from cache");
            const resultJSON = JSON.parse(result);
            return res.status(200).json(resultJSON);

        } else { 
            // Second check S3
            console.log("Trying from S3");

            // S3 bucket / search params
            const params = {
                Bucket: bucketName,
                Key: searchingKey
            };

            // attempt to return from S3
            return new AWS.S3({
                apiVersion: '2006-03-01'
            }).getObject(params, (err, result) => {
                if (result) {

                    console.log("Returning result from S3");
                    console.log(result);
                    // parse returned result
                    const resultJSON = JSON.parse(result.Body);

                    let redisJSON = JSON.parse(result.Body);
                    // update where you got it from
                    redisJSON.source = 'Redis Cache';

                    // add result from S3 to Redis
                    redisClient.setex(searchingKey, 60,
                        JSON.stringify({
                            ...redisJSON,
                        })
                    );
                    // serve from S3
                    console.log("Sending from S3 to client");
                    return res.status(200).json(resultJSON);

                } else {

                    // serve from wikipedia API and store in S3 and in redis
                    return axios.get(searchUrl)
                        .then(response => {
                            console.log("Storing in S3 bucket");

                            const responseJSON = response.data;
                            const body = JSON.stringify({
                                source: 'S3 Bucket',
                                ...responseJSON
                            });
                            const objectParams = {
                                Bucket: bucketName,
                                Key: searchingKey,
                                Body: body
                            };

                            // send to bucket
                            const uploadPromise = new AWS.S3({
                                apiVersion: '2006-03-01'
                            }).putObject(objectParams).promise();
                            // inform console of success
                            uploadPromise.then(function(data) {
                                console.log("Good news!");
                                console.log("Successfully uploaded data to " + bucketName +
                                    "/" + searchingKey);
                            });

                            // add to redis
                            redisClient.setex(
                                searchingKey, 60,
                                JSON.stringify({
                                    source: 'Redis Cache',
                                    ...responseJSON,
                                })
                            )

                            return res.status(200).json({
                                source: 'Wikipedia API',
                                ...responseJSON,
                            });
                        })
                        .catch(err => {
                            console.log("Not good news..");
                            return res.json(err);
                        });
                }
            })
        }
    })
})

app.listen(3000, () => {
    console.log('Server listening on port: ', 3000);
});