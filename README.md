# Retro Minds Listing Generator

Local web app for **Retro Minds Collective** ([retromindscreations.com](https://www.retromindscreations.com)) — turns raw product photos into ready-to-list items for Square, Etsy, TikTok Shop, and Meta Shop.

Products: 3D printed **pots**, **plant trellises**, **vases**, **wall planters**, **table lamps**, and home decor.

## Features

- **New Item flow** — Upload photos, set name/category/modifiers/price/SKU, generate listing
- **AI studio photos** — Hyperrealistic product images on pure white background (OpenAI)
- **AI listing copy** — Etsy title, description, and 13 tags; shop title defaults to Etsy title
- **Review & edit** — Pick primary image, regenerate photos, edit all fields, save to database
- **Library** — Search/filter by category and status, multi-select export
- **Square CSV export** — Maps items and modifier variations to Square import columns

## Requirements

- Python 3.10+ (see setup below — **Xcode is not required**)
- OpenAI API key with access to image editing and chat models

## Setup (no Xcode)

On a fresh Mac, `python3` is often a stub that asks for Xcode Command Line Tools. **You do not need Xcode.** Run the included setup script instead — it installs standalone Python via [Miniforge](https://github.com/conda-forge/miniforge) if needed:

```bash
cd ~/Projects/product-listing-generator
bash setup.sh
```

Then add your API key to `.env`:

```bash
# Edit .env and set OPENAI_API_KEY=sk-...
```

**Alternative:** Install Python from [python.org/downloads](https://www.python.org/downloads/) and use that `python3` instead of the system one.

## Run

```bash
source .venv/bin/activate
python run.py
```

Open **http://127.0.0.1:8080** in your browser.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required for generation |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | Image edit model |
| `OPENAI_TEXT_MODEL` | `gpt-4o-mini` | Listing copy model |
| `DATABASE_PATH` | `./data/db.sqlite` | SQLite database |
| `UPLOAD_DIR` | `./data/uploads` | Original uploads |
| `GENERATED_DIR` | `./data/generated` | AI-generated images |

## Categories & Modifiers

Edit `config/categories.json` to customize categories and default modifiers. Enabled modifiers with comma-separated values (e.g. `S, M, L`) become Square item variations on export.

## Database

SQLite is the source of truth at `data/db.sqlite`. Tables:

- **items** — All listing fields, status (`draft`, `generating`, `ready`)
- **images** — Original and generated photos linked to items

Future phases (Etsy, TikTok Shop, Meta Shop APIs) can read directly from this database.

## Square Export

Export selected ready items from the Library view. CSV columns match Square's item import template:

`Token`, `Item Name`, `Variation Name`, `SKU`, `Description`, `Reporting Category`, `Category`, `Price`, `Option Name 1–3`, `Option Value 1–3`

## Project Structure

```
product-listing-generator/
├── app/
│   ├── main.py              # FastAPI routes
│   ├── db.py                # SQLite schema
│   ├── repository.py        # Data access
│   ├── config.py            # Categories loader
│   └── services/
│       ├── image_gen.py     # OpenAI image editing
│       ├── text_gen.py      # OpenAI listing copy
│       └── square_export.py # CSV export
├── config/categories.json
├── static/                  # CSS + JS
├── templates/index.html
├── data/                    # DB, uploads, generated images
├── run.py
└── requirements.txt
```
