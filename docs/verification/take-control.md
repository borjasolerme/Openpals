# Taking control of a bot's computer

Run the focused checks in disposable homes:

```sh
pnpm exec vitest run src/components/ComputerPanel.takeover.test.ts src/components/computer-takeover.test.ts src/components/ComputerPanel.simple.test.ts
pnpm exec vitest run server/computer-take-control.e2e.test.ts server/boat-desktop-link.test.ts server/vps-computer.test.ts server/routes/desktop-viewer.test.ts
```

The panel checks mount the real `ComputerPanel` with its real control requests;
only the live desktop itself is a stand-in. They prove:

- On a VPS, **Take control** turns the panel's own picture into
  the live desktop at once, and **Full screen** takes control straight into a
  view that fills the window. Nothing opens in another window or tab. The take
  carries this view's control lease.
- **Hand control back** releases the computer at once and the panel returns to
  watching.
- Closing the panel, leaving its Computer view, opening another conversation or
  closing the page gives back the hold this view took, with a keepalive request,
  and never a hold another device has.
- A hand-back from elsewhere ends the live view once it has lasted a second and
  a half; an out-of-order event does not end it.
- A desktop that never comes up gives the computer back and says so.
- Handing back a VPS also closes its viewer tunnel.
- A cloud computer's desktop is hosted by its provider, so it still opens in
  the app's viewer window. On plain web it opens in its own tab, cut off from
  the app; closing that tab gives the computer back, and a failed join closes it
  and gives the computer back.

The server checks run the real routes against a stub Boat relay that holds every
screen capture. They prove that a screen preview in flight never blocks taking
control or the desktop link, for a bot's own cloud computer, a team's shared one
and the Team map's take, while putting the computer to sleep still waits for the
capture, and two viewers share one capture. Each request for a desktop link is
bounded, so a provider that never answers cannot leave the bot waiting. A VPS
desktop gets a process cap of 4096; one made under the old 512 cap is
raised in place once, and a cap someone chose stays.
