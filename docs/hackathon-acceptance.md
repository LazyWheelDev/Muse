# Muse hackathon MVP acceptance

This is the short physical acceptance gate for the hackathon demo. It complements
the exhaustive [Raspberry Pi validation procedure](raspberry-pi-validation.md);
it does not replace endurance, large-dataset, or destructive recovery testing.

Record date, release ID, Git commit, Raspberry Pi OS, Chromium, display stack,
connector, touch device, and operator. Mark each item pass, fail, or not tested.

- [ ] Cold power-on reaches Home without desktop, terminal, browser chrome, or
      manual launch.
- [ ] The complete UI is visible at 1280 × 800 without cropping or horizontal
      overflow.
- [ ] Touch aligns at all four corners and essential controls respond reliably.
- [ ] A local JPEG, PNG, or WebP garment import completes and remains visible.
- [ ] A real iPhone QR import works on the same private LAN with no cloud or WAN.
- [ ] Wardrobe navigation and filtering work.
- [ ] Clothing Details edits persist.
- [ ] Outfit Builder drag, resize, rotate, layer, save, and update work.
- [ ] Saved Outfits reopens the saved composition.
- [ ] Settings persist after Chromium restart and device reboot.
- [ ] Sleep Display hides the UI and the next input wakes without activating an
      underlying control.
- [ ] A backup is created and `muse-ctl backup-verify` passes.
- [ ] Garments, outfits, Settings, and backup survive reboot.
- [ ] Core wardrobe use works with WAN disconnected.
- [ ] `127.0.0.1:8000` is the only main API binding.
- [ ] The private-LAN port exposes the phone surface only; all tested core paths
      return 404.
- [ ] The complete demo flow reports no current or historical throttling flag.
- [ ] The supported shutdown mechanism acknowledges, shuts down cleanly, and
      never exposes a generic command capability.
- [ ] One application-service restart returns to readiness with data intact.

Do not block the hackathon demo on 60 garments, 60 outfits, multiple destructive
power-loss tests, or multi-hour endurance. Record those as later exhaustive
validation work, never as silently passed.
