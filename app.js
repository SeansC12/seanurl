import express from "express";

import { createClient } from "redis";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";

import createHomePage from "./views/index.js";
import createMyLinkRow from "./views/MyLinks.js";
import createSuccessCard from "./views/Success.js";
import createErrorCard from "./views/Error.js";
import create404Page from "./views/404.js";
import * as dotenv from "dotenv";

// Express setup
const app = express();
const port = 3000;
const WEBSITE_DOMAIN = "https://linkify.fly.dev";
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(express.static("public"));
app.use(cookieParser());

// Environment variables setup
dotenv.config();

// Redis Client setup
const client = createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

// FT.CREATE idx:url ON hash PREFIX 1 "url:" SCHEMA alias TEXT

(async () => {
  await client.connect();
})();

// GET /
app.get("/", async (req, res) => {
  res.send(createHomePage());
});

// GET /createShortenedUrl
app.post("/createShortenedUrl", async (req, res) => {
  try {
    const urlToDirect = req.body.urlToDirect;
    const alias = req.body.shortenedUrlAlias;

    const isValidUrl = (url) => {
      try {
        new URL(url);
        return true;
      } catch (err) {
        return false;
      }
    };

    const isValidAlias = (alias) => {
      // Make it such that the alias can only contain letters and hyphens
      const aliasRegex = /^[a-zA-Z0-9-_]+$/;
      return aliasRegex.test(alias);
    };

    if (!isValidUrl(urlToDirect)) {
      throw "Invalid URL. Please enter a valid URL.";
    }

    if (!isValidAlias(alias)) {
      throw "Invalid alias. Please enter a valid alias.";
    }

    if (alias === "" || alias.length === 0) {
      throw "Invalid. Input field is empty.";
    }

    if (alias.length > 50 || urlToDirect.length > 2000) {
      throw "Invalid. Input field is too long.";
    }

    if (alias.length < 5) {
      throw "Invalid. Alias must be at least 5 characters.";
    }

    const shortenedUrl = `${WEBSITE_DOMAIN}/${alias}`;
    const url_uuid = `url:${randomUUID()}`;

    client.on("error", (err) => {
      throw err;
    });

    const escapedHyphenAlias = alias.replace(/-/g, "\\-");
    const results = await client.ft.search("idx:url", `@alias:{${escapedHyphenAlias}}`);

    if (results.documents[0]) {
      res.status(400).send(createErrorCard("This alias is already taken. Please try another one."));
      return;
    }

    await client.hSet(url_uuid, {
      urlToDirect: urlToDirect,
      alias: alias,
      visits: 0,
    });

    const successMessage = `URL shortened successfully! Your shortened URL is: <a href="${shortenedUrl}">${shortenedUrl}</a>`;
    res.send(createSuccessCard(successMessage));
  } catch (err) {
    res.status(400).send(createErrorCard(err));
  }
});

// GET /retrieveMyLinks
app.get("/retrieveMyLinks", async (req, res) => {
  const links = req.cookies;
  if (!links.shortenedUrlAlias) {
    res.send("You have no shortened links.");
    return;
  }

  const aliases = links.shortenedUrlAlias.split(",");

  let returnHTML = "";

  // try {
  //   const results = await client.ft.search("idx:url", `@alias:${aliases[8]}`);
  //   console.log(aliases, results);
  // } catch (err) {
  //   console.log(err);
  // }
  // res.send("Ok");

  for (const alias of aliases) {
    let results;
    // Generate a new alias that inserts a backslash before every hyphen
    const escapedHyphenAlias = alias.replace(/-/g, "\\-");

    try {
      results = await client.ft.search("idx:url", `@alias:{${escapedHyphenAlias}}`);
    } catch (err) {
      res.status(400).send("Something went wrong. Please try again.");
      return;
    }

    if (!results.documents[0]) {
      res.send("This link does not exist. Something went wrong. Please try again.");
      return;
    }

    const urlToDirect = results.documents[0].value.urlToDirect;

    const visits = results.documents[0].value.visits;

    returnHTML += createMyLinkRow(alias, urlToDirect, visits);
  }

  res.send(returnHTML);
});

// GET /:shortenedUrl
app.get("/:alias", async (req, res) => {
  const alias = req.params.alias;

  // Search for the URL in Redis
  const escapedHyphenAlias = alias.replace(/-/g, "\\-");

  const results = await client.ft.search("idx:url", `@alias:{${escapedHyphenAlias}}`);
  if (results.documents[0]) {
    // Fix the URL if it doesn't have a protocol
    let url = results.documents[0].value.urlToDirect;
    const urlProtocols = ["http://", "https://"];

    if (
      url.substring(0, urlProtocols[0].length) !== urlProtocols[0] &&
      url.substring(0, urlProtocols[1].length) !== urlProtocols[1]
    ) {
      url = urlProtocols[1] + url;
    }

    res.redirect(url);

    // Adds one visit to this URL in Redis
    const url_uuid = results.documents[0].id;

    await client.hIncrBy(url_uuid, "visits", 1);
  } else {
    res.send(create404Page());
  }
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
