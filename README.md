# Muse

Muse is a dedicated smart wardrobe designed for a touchscreen device powered by Raspberry Pi.

It helps users organize their clothes, browse their wardrobe visually, compose outfits, and save combinations through a polished offline-first experience.

## Vision

Muse turns a physical wardrobe into an interactive digital product.

The final device is designed to launch directly into Muse, without exposing the underlying operating system, desktop, terminal, or technical setup.

## Core Principles

- Offline first
- No mandatory subscription
- Local storage by default
- Touchscreen focused
- Simple and polished
- User controlled
- Raspberry Pi ready

## Build Week MVP

The first version of Muse will include:

- A visual wardrobe library
- Clothing categories
- A silhouette-based outfit builder
- Manual clothing placement and layering
- Saved outfits
- Local storage
- Phone-based clothing import
- Raspberry Pi kiosk mode

## Out of Scope for the MVP

The following features are intentionally excluded from the Build Week version:

- Photorealistic AI virtual try-on
- Cloud accounts
- Social features
- Marketplace integration
- Complex retailer scraping
- Weather recommendations
- Calendar integration
- Automatic outfit selection
- Native mobile applications

## Repository Structure

```text
assets/      Brand assets, screenshots, icons, and media
backend/     API, local database, image handling, and business logic
docs/        Product documentation, architecture, roadmap, and decisions
frontend/    Main touchscreen interface
kiosk/       Raspberry Pi startup, deployment, and kiosk configuration