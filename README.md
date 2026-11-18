# Live Agent Sample App

Test a live Tavus agent using [Recall.ai's Output Media API](https://docs.recall.ai/docs/stream-media)!

## Run locally

Requires [Node.js 22.13+](https://nodejs.org/en/download), which includes npm.

Copy `.env.example` to `.env` and configure the variables below. [Tavus setup instructions](#tavus-instructions) are below this section.

| Variable | Description |
| --- | --- |
| `TAVUS_API_KEY` | Your Tavus API key. |
| `TAVUS_PAL_ID` | Optional. Reuse an existing PAL. Leave empty to create a temporary PAL for each call. |
| `TAVUS_FACE_ID` | Face with a configured voice for newly created PALs. Optional when `TAVUS_PAL_ID` is set. |
| `TAVUS_MAX_CALL_DURATION` | Optional. Maximum call duration in seconds. Defaults to `600` (10 minutes). |
| `RECALL_API_KEY` | Your [Recall.ai API key](https://docs.recall.ai/reference/authentication). |
| `RECALL_REGION` | Optional. [Region of your Recall.ai workspace](https://docs.recall.ai/docs/regions). Defaults to `us-east-1`. |
| `PORT` | Optional. Local app port. Defaults to `3000`. |

```sh
./run.sh
```

The script installs dependencies, starts the app on `PORT` (default `3000`), and opens an ngrok tunnel to that port. The bot uses the tunnel address automatically. Open the local URL printed in the terminal. Keep the terminal open during calls; Ctrl+C stops both processes.

## Tavus instructions

1. Sign in to [Tavus PAL Maker](https://maker.tavus.io/). Open **API Key** and create or copy a key, following [Tavus authentication setup](https://docs.tavus.io/api-reference/authentication). Save it as `TAVUS_API_KEY` in `.env`; the app uses it only on the server.
2. To reuse an existing PAL, set `TAVUS_PAL_ID` in `.env` to a PAL accessible to your Tavus key. It must have its face and voice configured. The app uses its saved prompt and wake-word settings without editing, cloning, or deleting that PAL. `TAVUS_FACE_ID` is not required in this mode.

   **OR**

   To create a temporary PAL for each call, leave `TAVUS_PAL_ID` empty. Choose a [stock or custom Tavus face](https://docs.tavus.io/sections/faces/overview) accessible to that key and save its ID as `TAVUS_FACE_ID`. Use a face with a configured voice. Faces trained from a photo need a voice attached separately.

## Using the app

Open http://localhost:3000 (the default), enter your context in the system prompt, set the bot name, and toggle wake words as needed. Enter the meeting URL and click **Send bot to call**. If you configured an existing PAL, its saved prompt and wake-word settings are used instead.

## How it works

This app has two webpages. **The launch form** at `http://localhost:3000` is the page you open to configure and send the agent. **The avatar page** at `/avatar` is a separate page that Recall opens inside the bot's browser. It receives meeting audio and plays the agent's audio and video.

1. **A bot is created.** The backend calls Recall's [Create Bot API](https://docs.recall.ai/reference/bot_create) with the meeting URL, bot name, and the address of the avatar page in `output_media.camera`. Ngrok provides a public HTTPS address for the app. The bot opens `/avatar` through that tunnel.
2. **A bot joins the meeting and streams the avatar page's audio and video into the meeting.** The bot opens the avatar page in its browser, as configured through the [Output Media API](https://docs.recall.ai/docs/stream-media). The page's visible content becomes the bot's camera output, and audio played by the page becomes the bot's microphone output in the meeting.
3. **Meeting audio is supplied to the page.** The browser's microphone input contains the other meeting participants' audio. The avatar page uses Daily's JavaScript SDK to capture this input and send it to Tavus.
4. **Media flows continuously during the call.** Meeting audio flows into the page, and agent responses stream back into the meeting through Output Media. The local server and HTTPS tunnel stay running to serve the page and handle cleanup.
5. **Clean up.** When the avatar page closes or its media connection ends, it asks the backend to end the Tavus conversation. The backend also deletes the temporary PAL if this app created one.
