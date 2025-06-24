# ⏱️ Twitch Time Watched Tracker (Chrome Extension)

Track how much time you spend watching different Twitch channels — with breakdowns by streamer and category. All data is stored locally, and a clean dashboard is included.

## 🔧 Features

- Tracks time watched per **Twitch channel** and **category**
- Works even across multiple browser windows or monitors
- Human-readable dashboard: minutes, hours, days
- Hover tooltips for quick info
- Dark mode support
- Export stats to JSON
- Manual input of known watch time per channel

## 📦 Installation

1. **Download or Clone the Repo**

   ```
   git clone https://github.com/EliothMonroy/twitch-watched-time-tracker.git
   ```

2. **Open Chrome** and go to:  
   `chrome://extensions/`

3. **Enable Developer Mode** (toggle in top right)

4. **Click "Load unpacked"** and select the folder where this extension lives (the folder containing `manifest.json`)

5. ✅ The Twitch Time Tracker icon should now appear in your browser toolbar!

## 📊 Using the Dashboard

- Click the extension icon to view your **Top 5 most watched channels**
- Click **"Open Full Dashboard"** to launch a full page with charts
- Hover over bars and labels to view tooltips
- Export data with the "Export JSON" button

## 🛠 Optional: Set Initial Watch Time

If you already know your watch time from Twitch Recap, you can:

1. Open the extension popup
2. Click **"Set Initial Watch Time"**
3. Enter channel name and time (e.g., `90` for 90 minutes or `1:30` for 1 hour 30 mins)

## 🔒 Privacy

- No data is ever sent to a server
- All watch stats are stored locally in `chrome.storage.local`
- You can export or reset your data at any time

## 📥 Export / Backup

Click the **"Export JSON"** button in the popup to download your watch stats.

## 📷 Screenshots

(Add screenshots of popup and dashboard here)

## 🙋‍♂️ Questions or Suggestions?

Feel free to open an issue or contact me.
