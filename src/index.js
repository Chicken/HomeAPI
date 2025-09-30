const mariadb = require("mariadb");
const express = require("express");
require("dotenv").config();

const app = express();
app.listen(process.env.PORT);

app.set("trust proxy", process.env.TRUST_PROXY === "true");
const ratelimitMap = new Map();
const publicRequestPerMin = parseInt(process.env.PUBLIC_REQ_PER_MIN);
function publicRatelimit(req, res, next) {
  if (!ratelimitMap.has(req.ip)) ratelimitMap.set(req.ip, { count: 0 });
  const ratelimit = ratelimitMap.get(req.ip);
  if (ratelimit.count >= publicRequestPerMin) {
    res.status(429).send({
      status: "Too many requests"
    });
    return;
  }
  ratelimit.count++;
  setTimeout(() => {
    const rl = ratelimitMap.get(req.ip);
    if (rl) rl.count--;
  }, 60 * 1000);
  next();
}

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

app.get("/electricity_prices", publicRatelimit, async (req, res) => {
  const electricityMargin = typeof req.query.margin === "string" && !Number.isNaN(parseFloat(req.query.margin)) ? parseFloat(req.query.margin) : 0;

  let conn = await pool.getConnection().catch(() => null);
  if (!conn) {
    res.status(500).send({
      status: "Failed to get a database connection"
    });
    return;
  }
  const prices = await conn.query("SELECT time, price, alv FROM electricity_prices ORDER BY time DESC LIMIT 300").catch(() => null);
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

  const todayPrices = prices.filter((entry) => entry.time >= startOfToday && entry.time < endOfToday).map(entry => {
    entry.price = parseFloat((entry.price * (1 + entry.alv) + electricityMargin).toFixed(3));
    delete entry.alv;
    return entry;
  });
  const tomorrowPrices = prices.filter((entry) => entry.time >= startOfTomorrow && entry.time < endOfTomorrow).map(entry => {
    entry.price = parseFloat((entry.price * (1 + entry.alv) + electricityMargin).toFixed(3));
    delete entry.alv;
    return entry;
  });

  const todayPricesAvg = parseFloat((todayPrices.reduce((acc, entry) => acc + entry.price, 0) / todayPrices.length).toFixed(3));
  const todayCheapest = todayPrices.reduce((acc, entry) => entry.price < acc.price ? entry : acc, todayPrices[0]);
  const todayMostExpensive = todayPrices.reduce((acc, entry) => entry.price > acc.price ? entry : acc, todayPrices[0]);
  const todayNow = todayPrices.find((entry) => entry.time < now);

  let tomorrowPricesAvg = null;
  let tomorrowCheapest = null;
  let tomorrowMostExpensive = null;
  let tomorrowNow = null;
  let tomorrowPricesRes = null;

  if (tomorrowPrices.length > 12) {
    tomorrowPricesAvg = parseFloat((tomorrowPrices.reduce((acc, entry) => acc + entry.price, 0) / tomorrowPrices.length).toFixed(3));
    tomorrowCheapest = tomorrowPrices.reduce((acc, entry) => entry.price < acc.price ? entry : acc, tomorrowPrices[0]);
    tomorrowMostExpensive = tomorrowPrices.reduce((acc, entry) => entry.price > acc.price ? entry : acc, tomorrowPrices[0]);
    tomorrowNow = tomorrowPrices.find((entry) => entry.time < now + 24 * 60 * 60);
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
