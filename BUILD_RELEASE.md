# Build and Release Instructions

## Overview

This project uses webpack to bundle all HTML, CSS, JavaScript, and images into a single all-in-one HTML file. The GitHub workflow automatically builds and releases this file when you create a new tag.

## How to Create a Release

1. Make sure all your changes are committed
2. Create and push a new tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
3. The GitHub workflow will automatically:
   - Install dependencies
   - Build the all-in-one HTML file using webpack
   - Create a new release with the tag
   - Upload the bundled HTML file to the release

## Manual Build

To build locally:

```bash
# Install dependencies
npm install

# Build the all-in-one HTML file
npm run build
```

The output will be in the `dist/` directory as `index.html`.

## How It Works

1. **build-scripts/prepare-html.js**: Pre-build script
   - Reads the original `index.html`
   - Removes local CSS and JavaScript references
   - Generates temporary `index.build.html` for webpack

2. **webpack.config.js**: Configures webpack to bundle all assets
   - Uses `style-loader` to inline CSS
   - Uses `asset/inline` to embed images as base64
   - Uses `html-inline-script-webpack-plugin` to inline JavaScript
   - Uses `index.build.html` as template (generated dynamically)

3. **bundle-entry.js**: Entry point that imports all resources
   - Imports CSS files
   - Imports JavaScript modules
   - Imports and sets logo image

4. **package.json scripts**:
   - `prebuild`: Automatically runs before build to generate `index.build.html`
   - `build`: Runs webpack to bundle everything
   - `postbuild`: Cleans up temporary `index.build.html` file

5. **.github/workflows/release.yml**: GitHub workflow
   - Triggers on tag push
   - Builds the project (prebuild → build → postbuild)
   - Creates a release with the bundled HTML file

## External Dependencies

The bundled HTML file still relies on these CDN resources:
- Font Awesome (icons)
- Chart.js (charts and graphs)

These are loaded from CDN to keep the file size reasonable and leverage browser caching.
