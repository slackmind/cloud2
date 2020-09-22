require('dotenv').config();
const AWS = require('aws-sdk');
const express = require('express');
const responseTime = require('response-time')
const axios = require('axios');
const redis = require('redis');
const app = express();

// create unique bucket name
const bucketName = 'johnyoungatqut-wikipedia-store';
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

bucketPromise.then(function (data) {
        console.log("Successfully created " + bucketName);
    })
    .catch(function (error) {
        console.log("Bucket Creation Error!");
        console.log(error, error.stack);
    });

app.get('/api/store', (req, res) => {
    const key = (req.query.key).trim();

    // Construct the wiki URL and s3 key
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${key}`;
    const searchingKey = `wikipedia-${key}`;

    // check redis cache
    return redisClient.get(searchingKey, (err, result) => {
        console.log("Trying Redis Cache");

        if (result) {
            // Serve from Cache
            console.log("Success from cache");
            const resultJSON = JSON.parse(result);
            return res.status(200).json(resultJSON);

        } else {
            console.log("Trying from S3");

            // check S3
            const params = {
                Bucket: bucketName,
                Key: searchingKey
            };

            return new AWS.S3({
                apiVersion: '2006-03-01'
            }).getObject(params, (err, result) => {
                if (result) {

                    console.log("Returning result from S3");
                    // S3 caches in binary octet, need to convert
                    let newResult = result.Body.toString('utf-8');
                    
                    console.log(newResult);

                    // add ORIGINAL (not .toString) result from S3 to Redis
                    redisClient.setex(searchingKey, 3600,
                        JSON.stringify({
                            source: 'Redis Cache',
                            ...result,
                        })
                    );
                    // serve from S3
                    const resultJSON = JSON.parse(newResult);
                    return res.status(200).json(resultJSON);

                } else {

                    // serve from wikipedia API and store in S3 and in redis
                    return axios.get(searchUrl)
                        .then(response => {
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
                            }).putObject(objectParams).promise();

                            uploadPromise.then(function (data) {
                                console.log("Good news!");
                                console.log("Successfully uploaded data to " + bucketName +
                                    "/" + searchingKey);
                            });

                            // add to redis
                            redisClient.setex(
                                searchingKey, 3600,
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

/*
            console.log("result from wikipedia API");
            // Serve from Wikipedia API and store in cache
            return axios.get(searchUrl)
                .then(response => {
                    console.log("storing response data");
                    const responseJSON = response.data;
                    redisClient.setex(
                        searchingKey, 3600,
                        JSON.stringify({
                            source: 'Redis Cache',
                            ...responseJSON,
                        }));
                    return res.status(200).json({
                        source: 'Wikipedia API',
                        ...responseJSON,
                    });
                })
                .catch(err => {
                    console.log("Oh no!  Error!!");
                    return res.json(err);
                }); 
        }
    });
    // check S3
    const params = { 
        Bucket: bucketName,
        Key: searchingKey
        };

    return new AWS.S3({
        apiVersion: '2006-03-01'
    }).getObject(params, (err, result) => {
        if (result) {
            // serve from S3
            console.log("from S3");
            console.log(result);
            const resultJSON = JSON.parse(result.body);

        } else {
            // serve from wikipedia API and store in S3
            return axios.get(searchUrl)
            .then(response => {
                const responseJSON  = response.data;
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
                }).putObject(objectParams).promise();

                uploadPromise.then(function(data) {
                    console.log("Good news!");
                    console.log("Successfully uploaded data to " + bucketName + 
                    "/" + searchingKey);
                });

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
    });*/




app.get('/api/search', (req, res) => {

    const query = (req.query.query).trim();

    // Construct the wiki URL and key
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`;
    const searchingKey = `wikipedia:${query}`;

    // Try the cache
    return redisClient.get(searchingKey, (err, result) => {
        console.log("part1");

        if (result) {
            // Serve from Cache
            console.log("result from cache");
            const resultJSON = JSON.parse(result);
            return res.status(200).json(resultJSON);

        } else {
            console.log("result from wikipedia API");
            // Serve from Wikipedia API and store in cache
            return axios.get(searchUrl)
                .then(response => {
                    console.log("storing response data");
                    const responseJSON = response.data;
                    redisClient.setex(
                        searchingKey, 3600,
                        JSON.stringify({
                            source: 'Redis Cache',
                            ...responseJSON,
                        }));
                    return res.status(200).json({
                        source: 'Wikipedia API',
                        ...responseJSON,
                    });
                })
                .catch(err => {
                    console.log("Oh no!  Error!!");
                    return res.json(err);
                });
        }
    });
});
app.listen(3000, () => {
    console.log('Server listening on port: ', 3000);
});





/* maybe        
// Handle the promise fulfulled/reject states
bucketPromise.then(function(data) {
    // create params for putObj call
    const objectParams = {
        Bucket: bucketName,
        Key: s3Key,
        Body: 'Sam Wonder Dog'
        };
    // create object upload promise
    const uploadPromise = new AWS.S3({
        apiVersion: '2006-03-01'
    }).putObject(objectParams).promise();
    uploadPromise.then(function(data) {
        console.log("Successfully uploaded to " + bucketName + "/" + s3Key);
    });
}).catch(function(err) {
    console.log("oh no!");
    console.error(err, err.stack);
}) 







// check S3
    const params = { 
        Bucket: bucketName,
        Key: searchingKey
        };

    return new AWS.S3({
        apiVersion: '2006-03-01'
    }).getObject(params, (err, result) => {
        if (result) {
            // serve from S3
            console.log("from S3");
            console.log(result);
            const resultJSON = JSON.parse(result.body);

        } else {
            // serve from wikipedia API and store in S3
            return axios.get(searchUrl)
            .then(response => {
                const responseJSON  = response.data;
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
                }).putObject(objectParams).promise();

                uploadPromise.then(function(data) {
                    console.log("Good news!");
                    console.log("Successfully uploaded data to " + bucketName + 
                    "/" + searchingKey);
                });

                return res.status(200).json({
                    source: 'Wikipedia API',
                    ...responseJSON,
                });
            })
            .catch(err => {
                console.log("Not good news..");
                return res.json(err);
            });
        }*/