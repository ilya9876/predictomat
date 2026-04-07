# Predictomat

Predictomat is a lightweight static website for tracking selected Polymarket markets over time.

The site compares two probability series for each market:

- the current crowd-implied probability from Polymarket
- my own structured forecast estimate

The goal is not to provide investment advice or trading signals. The site is designed as a transparent public log of probability differences, market divergence, and repricing over time.

## What the site shows

For each tracked market, the website displays:

- the market title
- a link to the original Polymarket page
- the latest crowd probability
- the latest forecast probability
- the current gap between both values
- the peak divergence within the visible snapshot window
- the date of peak divergence
- an early-lead status (`confirmed` or `not yet`) indicating whether the crowd later moved toward a prior forecast estimate
- a chart based on the most recent daily snapshots

The hero section dynamically displays the total number of tracked markets.

## Data model

The frontend reads a single public JSON file:

`data/desired.json`

This file represents the full desired state of the website.

Each upload replaces the previous state completely.

At the top level, the JSON contains:

- `last_updated`
- `markets[]`

Each market contains:

- `track_id`
- `title`
- `polymarket_url`
- `status` (`active` or `archived`)
- `snapshots[]`

Each snapshot contains:

- `date`
- `crowd_probability_percent`
- `my_probability_percent`

## Project structure

```text
/
  index.html
  styles.css
  app.js
  favicon.svg
  imprint.html
  privacy.html
  terms.html
  .nojekyll
  README.md
  .gitignore
  /data
    desired.json
  /assets
    logo-pixel.svg
```

## How it works

This project is intentionally simple:

- no backend
- no database
- no user accounts
- no analytics by default
- no API secrets
- no build step required for the MVP

The frontend loads `data/desired.json`, filters markets by `status`, calculates a few lightweight metrics in the browser, and renders the page.

## Deployment

The site is designed for GitHub Pages.

To publish it:

1. Upload the repository contents to GitHub
2. Keep the `.nojekyll` file in the root directory
3. Enable GitHub Pages in the repository settings
4. Make sure `data/desired.json` contains your latest desired state

## Notes

- `Active` and `Archived` views are controlled entirely by the `status` field in `desired.json`
- the site is mobile-first and intentionally minimal
- the legal pages (imprint, privacy policy, terms of use) are included as static HTML files in English
- `index.html` is indexable; legal pages carry `noindex, nofollow`
- texts and styling can be adjusted later without changing the core rendering logic

## Disclaimer

Predictomat is provided for informational purposes only.
It is not investment advice, not financial advice, and not a trading recommendation.
