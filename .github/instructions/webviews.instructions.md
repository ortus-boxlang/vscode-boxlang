---
applyTo: 'webviews/**'
---

# Building Webviews

Some webviews in this extension use modern frontend tooling (Vite) to build the webview code. To build these webviews, run the following command from the root of the repository:

```
npm run build:webviews
```

This will compile the webview source code and output the built files to the appropriate locations for use in the extension. Make sure to run this command whenever you make changes to the webview source code to ensure that the latest changes are reflected in the extension.

## Webview Development

Dependencies

- alpinejs
- custom css (use BEM methodology)