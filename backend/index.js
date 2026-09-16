import express from 'express';
import bodyParser from 'body-parser';
import pg from 'pg';

const app = express();
const port = 3001;

app.listen(port, () => {
    console.log(`API is running at http://localhost:${port}`);
})