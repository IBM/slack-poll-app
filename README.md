# slack-poll-app

## Current Features

- One active poll per channel
- Polls stored in-memory or cloudant
- Anonymous votes only


## How to use

1. Click to deploy to IBM Cloud: [![Deploy to IBM Cloud](https://bluemix.net/deploy/button.png)](https://bluemix.net/deploy?repository=https%3A%2F%2Fgithub.com%2Ftsaiyl%2Fslack-poll-app.git&branch=master)

2. [Create a slack app](https://api.slack.com/apps?new_app=1)

3. In the slack app, create a slash command:

    - Command: `/poll` or another command
    - Request URL: `https://your-slack-app-route/slack/command`, where route is obtained from Step 1.
    - Short Description: `Simple polling app hosted on IBM Cloud.`
    - Usage Hint: `"Would you like to play a game?"  "Chess"  "Falken's Maze"  "Thermonuclear War"`

4. Go to **Interactive Components**, and set Request URL to `https://your-slack-app-route/slack/action`

5. Go to **Basic Information**, write down **Client ID**, **Client Secret** and **Verification Token**

6. In deployed IBM Cloud app, set env var **CLIENT_ID**, **CLIENT_SECRET** and **VERIFY_TOKEN**


## Install app to your slack workspace

1. Visit https://your-ibm-cloud-app-route with browser

2. Click **Add to Slack** button

3. Confirm the authorization

4. After slack redirects back, if you see a message "Success!", you have installed the app to your slack workspace.

5. Check whether `poll` command shows up in your slack workspace.




