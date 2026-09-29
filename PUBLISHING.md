# Preview and publishing

## Live preview while you work

Double-click **`start-site.bat`**, or run `npm start` in a VS Code terminal. The preview opens at **http://localhost:8080**.

Keep the window open. Every time you save a file, the page refreshes by itself. Only your computer can see this address.

## Publish to the permanent website

The website is hosted free by **GitHub Pages** from the GitHub repository. To publish your latest changes, run this in a VS Code terminal:

```
npm run deploy
```

Or describe the change: `npm run deploy -- "Added tail sizing notes"`.

This saves a version of every changed file (a Git commit) and pushes it to GitHub. GitHub Pages then rebuilds the site, usually within a minute. You can watch progress on the repository's **Actions** tab.

You can also use VS Code's **Source Control** panel: type a message, click **Commit**, then **Sync Changes**.

## Good to know

- **Your data doesn't move with the website.** Designs, tests and notes are stored in the browser for each web address. What you enter on `localhost` won't appear on the GitHub Pages site, and the other way round. To move or share data, use **Dashboard → Export backup / Import backup**.
- **The code is public.** Free GitHub Pages sites need a public repository, so anyone can see the code. Team data isn't in the repository; it stays in each browser.
- **Undoing a change:** every published version is kept on GitHub. In VS Code, open the **Timeline** or **Source Control** view to see and restore earlier versions.
