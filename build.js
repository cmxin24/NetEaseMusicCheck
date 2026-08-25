const fs = require('fs');
const path = require('path');

const baseManifest = require('./manifest.base.json');

// Chrome-specific configuration
const chromeManifest = {
  ...baseManifest,
  background: {
    service_worker: "background.js"
  }
};

// Firefox-specific configuration
const firefoxManifest = {
  ...baseManifest,
  background: {
    scripts: ["background.js"]
  },
  browser_specific_settings: {
    gecko: {
      id: "mengxibitan.yu@gmail.com",
      strict_min_version: "109.0",
      data_collection_permissions: {
        required: ["none"]
      }
    }
  }
};

// Define paths
const DIST_DIR = path.join(__dirname, 'dist');
const CHROME_DIR = path.join(DIST_DIR, 'chrome');
const FIREFOX_DIR = path.join(DIST_DIR, 'firefox');

// Define assets to copy (add any other files/folders your extension needs)
const ASSETS_TO_COPY = ['background.js', 'images'];

function buildExtension(browser, manifest, outputDir) {
  console.log(`Building for ${browser}...`);

  // 1. Create the output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 2. Write the tailored manifest.json
  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // 3. Copy source files to the output directory
  ASSETS_TO_COPY.forEach(asset => {
    const srcPath = path.join(__dirname, asset);
    const destPath = path.join(outputDir, asset);

    if (fs.existsSync(srcPath)) {
      // fs.cpSync is supported in Node.js >= 16.7.0
      fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
      console.warn(`[WARNING] Asset not found: ${asset}`);
    }
  });

  console.log(`Build complete! Output: ${outputDir}\n`);
}

// Clean previous build
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}

// Execute builds
buildExtension('Chrome', chromeManifest, CHROME_DIR);
buildExtension('Firefox', firefoxManifest, FIREFOX_DIR);
