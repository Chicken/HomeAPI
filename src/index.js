const mariadb = require("mariadb");
const express = require("express");
require("dotenv").config();

const app = express();
app.listen(process.env.PORT);

process.env.TZ = "Europe/Helsinki";

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

app.get("/electricity_prices", async (req, res) => {
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
  const prices = await conn.query("SELECT time, price FROM electricity_prices ORDER BY time DESC LIMIT 50").catch(() => null);
  conn.release();
  if (!prices) {
    res.status(500).send({
      status: "Failed to get data",
    });
    return;
  }
  const today = new Date();
  const now = Math.floor(Date.now() / 1000);
  const startOfToday = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1000);
  const endOfToday = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime() / 1000);
  const startOfTomorrow = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime() / 1000);
  const endOfTomorrow = Math.floor(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2).getTime() / 1000);

  const todayPrices = prices.filter((entry) => entry.time >= startOfToday && entry.time < endOfToday);
  const tomorrowPrices = prices.filter((entry) => entry.time >= startOfTomorrow && entry.time < endOfTomorrow);

  const todayPricesAvg = parseFloat((todayPrices.reduce((acc, entry) => acc + entry.price, 0) / todayPrices.length).toFixed(3));
  const todayCheapest = todayPrices.reduce((acc, entry) => entry.price < acc.price ? entry : acc, todayPrices[0]);
  const todayMostExpensive = todayPrices.reduce((acc, entry) => entry.price > acc.price ? entry : acc, todayPrices[0]);
  const todayNow = todayPrices.findLast((entry) => entry.time > now);

  let tomorrowPricesAvg = null;
  let tomorrowCheapest = null;
  let tomorrowMostExpensive = null;
  let tomorrowNow = null;
  let tomorrowPricesRes = null;

  if (tomorrowPrices.length > 12) {
    tomorrowPricesAvg = parseFloat((tomorrowPrices.reduce((acc, entry) => acc + entry.price, 0) / tomorrowPrices.length).toFixed(3));
    tomorrowCheapest = tomorrowPrices.reduce((acc, entry) => entry.price < acc.price ? entry : acc, tomorrowPrices[0]);
    tomorrowMostExpensive = tomorrowPrices.reduce((acc, entry) => entry.price > acc.price ? entry : acc, tomorrowPrices[0]);
    tomorrowNow = tomorrowPrices.findLast((entry) => entry.time > now + 24 * 60 * 60);
    tomorrowPricesRes = tomorrowPrices;
  }

  res.status(200).send({
    now: now,
    today: {
      avg: todayPricesAvg,
      chepeast: todayCheapest,
      mostExpensive: todayMostExpensive,
      now: todayNow,
      prices: todayPrices,
    },
    tomorrow: {
      avg: tomorrowPricesAvg,
      chepeast: tomorrowCheapest,
      mostExpensive: tomorrowMostExpensive,
      now: tomorrowNow,
      prices: tomorrowPricesRes,
    },
  });
});
