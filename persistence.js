require('dotenv').config();
const AWS = require('aws-sdk');
const express = require('express');
const responseTime = require('response-time')
const axios = require('axios');
const redis = require('redis');
const app = express();

// create unique bucket name
const bucketName = 'johnyoungatqut-wikipedia-store';

// This section will change for Cloud Services
const redisClient = redis.createClient();

redisClient.on('error', (err) => {
    console.log("Error Reids");
});

// Used for header info later.
app.use(responseTime());

app.get('/api/search', (req, res) => {
    const query = (req.query.query).trim();
    // Construct the wiki URL and key
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=parse&format=json&section=0&page=${query}`;
    const redisKey = `wikipedia:${query}`;
    // Try the cache
    return redisClient.get(redisKey, (err, result) => {
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
                        redisKey, 3600,
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
                    console.log("error!!");
                    return res.json(err);
                });
        }
    });
});
app.listen(3000, () => {
            console.log('Server listening on port: ', 3000);
});