const mariadb = require("mariadb");
const express = require("express");
require("dotenv").config();

const app = express();
app.listen(process.env.PORT);

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PWD,
  database: process.env.DB_DB,
  connectionLimit: 5,
});

app.get("/", (req, res) => {
  res.status(200).send({
    status: "API online"
  });
});

app.get("/data", async (req, res) => {
  if (req.query.key !== process.env.KEY) {
    res.status(401).send({
      status: "Wrong key"
    });
    return;
  }
  let conn = await pool.getConnection().catch(() => null);
  if (!conn) {
    res.status(500).send({
      status: "Failed to get a database connection"
    });
    return;
  }
  let electricity = await conn.query("SELECT * FROM electricity ORDER BY time DESC LIMIT 1").catch(() => null);
  let water = await conn.query("SELECT * FROM water ORDER BY time DESC LIMIT 1").catch(() => null);
  let d = new Date();
  d.setUTCHours(0);
  d.setUTCMinutes(0);
  d.setUTCSeconds(0);
  d.setUTCMilliseconds(0);
  let startOfDay = Math.floor(d.getTime() / 1000);
  let tenMinAgo = Math.floor((Date.now() - (10 * 60 * 1000)) / 1000);
  let waterDay = await conn.query(`SELECT SUM(waterUsage) AS "usage" FROM water WHERE time > ${startOfDay} ORDER BY time DESC`).catch(() => null);
  let water10Min = await conn.query(`SELECT SUM(waterUsage) AS "usage" FROM water WHERE time > ${tenMinAgo} ORDER BY time DESC`).catch(() => null);
  conn.release();
  if (!electricity || !water || !waterDay || !water10Min) {
    res.status(500).send({
      status: "Failed to get data",
    });
    return;
  }
  const time = water[0].time;
  delete electricity[0].time;
  delete water[0].time;
  water[0].daily = waterDay[0].usage;
  water[0].tenMin = water10Min[0].usage;
  res.status(200).send({
    time,
    electricity: electricity[0],
    water: water[0],
  });
});
