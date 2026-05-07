require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const dns = require("dns");

const app = express();

app.use(cors());
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

const urlSchema = new mongoose.Schema({
  original_url: { type: String, required: true },
  short_url: { type: Number, required: true, index: true, unique: true },
});
const Url = mongoose.model("Url", urlSchema);

const counterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
const Counter = mongoose.model("Counter", counterSchema);

// atomic counter increment to ensure unique, sequential short IDs
async function getNextSequence(name) {
  const updated = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return updated.seq;
}

// promise-based DNS lookup for async/await consistency
function dnsLookupPromise(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
}

app.post("/api/shorturl", async (req, res) => {
  let originalUrl = req.body.url;

  try {
    const parsed = new URL(originalUrl);
    // validate protocol and hostname to ensure URL is reachable
    if (!parsed.protocol.startsWith("http") || !parsed.hostname) {
      return res.json({ error: "invalid url" });
    }

    // normalize URL by removing trailing slashes for consistency
    originalUrl = parsed.href.replace(/\/$/, "");

    // perform DNS lookup to validate hostname
    await dnsLookupPromise(parsed.hostname);

    let entry = await Url.findOne({ original_url: originalUrl });

    if (!entry) {
      const shortUrl = await getNextSequence("url_count");
      entry = await Url.create({
        original_url: originalUrl,
        short_url: shortUrl,
      });
    }

    res.json({
      original_url: entry.original_url,
      short_url: entry.short_url,
    });
  } catch (err) {
    console.error(err);
    return res.json({ error: "invalid url" });
  }
});

app.get("/api/shorturl/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    return res.json({ error: "invalid url" });
  }

  // use lean() for better performance on read-only redirect lookups
  const entry = await Url.findOne({ short_url: id }).lean();

  if (entry) {
    return res.status(302).redirect(entry.original_url);
  } else {
    return res.json({ error: "No short URL found for the given input" });
  }
});

const port = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI);

// start server only after a successful database connection
mongoose.connection.once("open", () => {
  app.listen(port, () => {
    console.log(`Connected to MongoDB. Listening on port ${port}`);
  });
});

mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});
