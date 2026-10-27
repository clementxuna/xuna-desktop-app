# Push notifications on Mac

What XUNA's web app and servers need to do so Mac users get notifications even when XUNA is
closed. The desktop app's part is done.

## How it fits together

1. At start-up the Mac app registers with Apple Push Notification service (APNs) and gets a
   device token for that Mac.
2. A XUNA page in the app reads it with `window.xunaDesktop.getPushRegistration()`.
3. The web app sends it to XUNA's servers, which store it with the signed-in user.
4. When the servers create a notification for that user, they also send it to APNs, and
   macOS shows it whether or not XUNA is open.

## Web app

```js
// After sign-in, and again each time the app starts, because a Mac's token can change.
const registration = await window.xunaDesktop?.getPushRegistration();
if (registration) {
  // { platform: 'macos', token: '6f1c…', topic: 'ai.xuna.desktop', environment: 'production' }
  await saveDeviceRegistration(registration); // a new server endpoint
}
```

- `window.xunaDesktop` exists only inside the desktop app. `getPushRegistration()` resolves to
  `null` on Windows, in development runs, when Apple refused the registration, and on pages
  outside xuna.ai.
- On sign-out, ask the server to forget the token. Otherwise the next person to sign in on
  that Mac gets the previous user's notifications.

## Servers

- Store tokens per user; one user can have several Macs. Treat the token as the key, so a
  re-registration replaces the old entry.
- Send each notification with an HTTP/2 `POST https://api.push.apple.com/3/device/<token>`:
  - `authorization: bearer <JWT>`: ES256, header `{ "alg": "ES256", "kid": "B46K99Z6C5" }`,
    claims `{ "iss": "57JSRUV65Y", "iat": <now, in seconds> }`, signed with the APNs key.
    Reuse each JWT for 20 to 60 minutes; Apple rejects new ones more often than that.
  - `apns-topic: ai.xuna.desktop`
  - `apns-push-type: alert`
  - Body:

    ```json
    {
      "aps": { "alert": { "title": "New message", "body": "Dana: Can we move the call?" }, "sound": "default", "thread-id": "conversation-42" },
      "url": "https://app.xuna.ai/conversations/42"
    }
    ```

    `thread-id` groups related notifications in Notification Center. `url` is for later: the
    app can't yet tell which notification was clicked, so clicking opens XUNA where it was.
- Apple's answers: 200 means Apple accepted it. 410 `Unregistered` or 400 `BadDeviceToken`
  means delete that token. 403 means the JWT or key is wrong.
- When XUNA is the frontmost app, macOS passes the push to the app instead of showing it. The
  user then sees only XUNA's own toast from the notification stream, not two alerts.

## The APNs key

- "XUNA AI Desktop Push", Key ID `B46K99Z6C5`, team `57JSRUV65Y`. It is limited to the topic
  `ai.xuna.desktop` and the production environment, which is what Developer ID apps use.
- It is a secret. Share it through a password manager, never in a repository. Apple can't
  issue it again. If it is lost or leaked, revoke it at developer.apple.com → Keys and make a
  new one with the same limits.

## Testing

1. On a Mac with a signed copy of the app, open XUNA, choose View → Toggle Developer Tools and
   run `await xunaDesktop.getPushRegistration()` in the console.
2. Send a push to that token as above. It should appear with XUNA in the background, and
   after quitting XUNA.
