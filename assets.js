// Assets procedural rendering module
const Assets = {
  _cache: {},
  noOptimize: null,

  checkOptimize() {
    if (this.noOptimize === null) {
      const urlParams = new URLSearchParams(window.location.search);
      this.noOptimize = urlParams.get('no_optimize') === 'true';
    }
    return this.noOptimize;
  },

  // Helper to get or create cached canvas
  getCached(key, drawFn, width, height, anchorX, anchorY) {
    if (this._cache[key]) {
      return this._cache[key];
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.translate(anchorX, anchorY);
    drawFn(ctx);
    this._cache[key] = canvas;
    return canvas;
  },

  clearCache() {
    this._cache = {};
  },

  // Draw Ellen
  drawEllen(ctx, x, y, outfit, frame, dir, scale = 1) {
    const animFrame = Math.floor(frame) % 24;
    if (this.checkOptimize()) {
      this._drawEllenDirect(ctx, x, y, outfit, animFrame, dir, scale);
      return;
    }
    const key = `ellen_${outfit}_${animFrame}_${scale}`;
    const cachedCanvas = this.getCached(
      key,
      (offscreenCtx) => {
        this._drawEllenDirect(offscreenCtx, 0, 0, outfit, animFrame, 1, 1);
      },
      80,
      110,
      40,
      95
    );

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.drawImage(cachedCanvas, -40, -95);
    ctx.restore();
  },

  _drawEllenDirect(ctx, x, y, outfit, frame, dir, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * scale, scale);

    // Bounce/breathing effect
    const bounce = Math.sin(frame * 0.15) * 2;
    const walkCycle = Math.sin(frame * 0.25);

    // --- LEGS ---
    ctx.fillStyle = outfit === 'wedding' ? '#ffffff' : '#3d5a80'; // wedding dress covers legs or pants
    if (outfit !== 'wedding') {
      // Leg 1
      ctx.save();
      ctx.translate(-6, -15);
      ctx.rotate(walkCycle * 0.4);
      ctx.fillRect(-3, 0, 6, 16);
      ctx.fillStyle = '#f28482'; // shoes
      ctx.fillRect(-4, 13, 8, 4);
      ctx.restore();

      // Leg 2
      ctx.save();
      ctx.translate(6, -15);
      ctx.rotate(-walkCycle * 0.4);
      ctx.fillRect(-3, 0, 6, 16);
      ctx.fillStyle = '#f28482'; // shoes
      ctx.fillRect(-4, 13, 8, 4);
      ctx.restore();
    }

    // --- BODY & DRESS/CLOTHES ---
    if (outfit === 'graduation') {
      ctx.fillStyle = '#1e1e24'; // Black gown
      ctx.beginPath();
      ctx.moveTo(-15, -45);
      ctx.lineTo(15, -45);
      ctx.lineTo(18, -12);
      ctx.lineTo(-18, -12);
      ctx.closePath();
      ctx.fill();

      // V-neck stripe (academic hood colors - purple/gold)
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, -45);
      ctx.lineTo(0, -32);
      ctx.lineTo(6, -45);
      ctx.stroke();
    } else if (outfit === 'wedding') {
      // Big white gown
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-12, -45);
      ctx.lineTo(12, -45);
      ctx.lineTo(24, 0);
      ctx.lineTo(-24, 0);
      ctx.closePath();
      ctx.fill();

      // Lace detailing at the hem
      ctx.fillStyle = '#f1f5f9';
      for (let i = -24; i <= 24; i += 8) {
        ctx.beginPath();
        ctx.arc(i, 0, 4, 0, Math.PI, true);
        ctx.fill();
      }
    } else if (outfit === 'casual') {
      // Pastel Pink top
      ctx.fillStyle = '#ffb5a7';
      ctx.fillRect(-12, -45 + bounce * 0.3, 24, 18);
      // Pants
      ctx.fillStyle = '#3d5a80'; // blue jeans
      ctx.fillRect(-12, -27 + bounce * 0.3, 24, 13);
    } else if (outfit === 'date_dress') {
      // Flowy coral/rose date dress
      ctx.fillStyle = '#e76f8a';
      ctx.beginPath();
      ctx.moveTo(-11, -45);
      ctx.lineTo(11, -45);
      ctx.lineTo(16, -10);
      ctx.lineTo(-16, -10);
      ctx.closePath();
      ctx.fill();
      // Sash belt
      ctx.fillStyle = '#c44569';
      ctx.fillRect(-12, -30 + bounce * 0.3, 24, 3);
      // White lace trim at hem
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = -16; i <= 16; i += 6) {
        ctx.beginPath();
        ctx.arc(i, -10, 3, 0, Math.PI, true);
        ctx.fill();
      }
    } else if (outfit === 'sundress') {
      // Yellow sundress for first home
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(-11, -45);
      ctx.lineTo(11, -45);
      ctx.lineTo(18, -8);
      ctx.lineTo(-18, -8);
      ctx.closePath();
      ctx.fill();
      // Floral pattern dots
      ctx.fillStyle = '#f4845f';
      [[-5,-38],[4,-35],[-2,-25],[6,-28],[0,-18]].forEach(([dx,dy]) => {
        ctx.beginPath();
        ctx.arc(dx, dy + bounce * 0.3, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      // Thin straps
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -45); ctx.lineTo(-6, -50);
      ctx.moveTo(6, -45); ctx.lineTo(6, -50);
      ctx.stroke();
    } else if (outfit === 'engagement_dress') {
      // Elegant blush/champagne dress
      ctx.fillStyle = '#f5cac3';
      ctx.beginPath();
      ctx.moveTo(-12, -45);
      ctx.lineTo(12, -45);
      ctx.lineTo(20, -6);
      ctx.lineTo(-20, -6);
      ctx.closePath();
      ctx.fill();
      // Sparkle details
      ctx.fillStyle = 'rgba(255,215,0,0.6)';
      [[-4,-40],[5,-36],[-6,-28],[3,-22],[0,-14]].forEach(([dx,dy]) => {
        ctx.beginPath();
        ctx.arc(dx, dy + bounce * 0.3, 1.2, 0, Math.PI * 2);
        ctx.fill();
      });
      // Thin waist ribbon
      ctx.fillStyle = '#e8a598';
      ctx.fillRect(-12, -30 + bounce * 0.3, 24, 2.5);
    } else if (outfit === 'mom_casual') {
      // Cozy lavender cardigan over white tee
      ctx.fillStyle = '#b8c0ff'; // lavender cardigan
      ctx.fillRect(-13, -45 + bounce * 0.3, 26, 19);
      // White tee peek
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-6, -45 + bounce * 0.3, 12, 6);
      // Comfy dark leggings
      ctx.fillStyle = '#2d3142';
      ctx.fillRect(-12, -26 + bounce * 0.3, 24, 12);
    } else if (outfit === 'hiking') {
      // Green jacket
      ctx.fillStyle = '#4f7a30';
      ctx.fillRect(-13, -45 + bounce * 0.3, 26, 19);
      // Leggings
      ctx.fillStyle = '#1e293b'; // black leggings
      ctx.fillRect(-11, -26 + bounce * 0.3, 22, 12);
      // Backpack
      ctx.fillStyle = '#d90429';
      ctx.fillRect(-18, -42 + bounce * 0.3, 6, 14);
    }

    // --- ARMS ---
    ctx.fillStyle = outfit === 'wedding' ? '#ffffff' :
                   (outfit === 'graduation' ? '#1e1e24' :
                   (outfit === 'mom_casual' ? '#b8c0ff' :
                   (outfit === 'engagement_dress' ? '#f5cac3' :
                   (outfit === 'date_dress' ? '#e76f8a' :
                   (outfit === 'sundress' ? '#ffd166' : '#fecfef')))));
    // Arm 1 (back)
    ctx.save();
    ctx.translate(-10, -42 + bounce * 0.3);
    ctx.rotate(-walkCycle * 0.3);
    ctx.fillRect(-3, 0, 6, 18);
    // Hand
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(0, 19, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Arm 2 (front)
    ctx.save();
    ctx.translate(10, -42 + bounce * 0.3);
    ctx.rotate(walkCycle * 0.3);
    ctx.fillStyle = outfit === 'wedding' ? '#ffffff' :
                   (outfit === 'graduation' ? '#1e1e24' :
                   (outfit === 'mom_casual' ? '#b8c0ff' :
                   (outfit === 'engagement_dress' ? '#f5cac3' :
                   (outfit === 'date_dress' ? '#e76f8a' :
                   (outfit === 'sundress' ? '#ffd166' : '#fecfef')))));
    ctx.fillRect(-3, 0, 6, 18);
    // Hand
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(0, 19, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- HEAD & FACE ---
    ctx.fillStyle = '#ffd1ac'; // Skin tone
    // --- HAIR: Back hair length (drawn behind the face skin) ---
    ctx.fillStyle = '#4a3728'; // Ellen: brown hair
    ctx.beginPath();
    ctx.moveTo(-14, -58 + bounce * 0.5);
    ctx.quadraticCurveTo(-18, -45, -12, -32 + bounce * 0.5);
    ctx.lineTo(-4, -32 + bounce * 0.5);
    ctx.quadraticCurveTo(-8, -48, -4, -58 + bounce * 0.5);
    ctx.closePath();
    ctx.fill();

    // --- SKIN: Head & Face ---
    ctx.fillStyle = '#ffd1ac'; // Skin tone
    ctx.beginPath();
    ctx.arc(0, -58 + bounce * 0.5, 13, 0, Math.PI * 2);
    ctx.fill();

    // --- HAIR: Front/top hair bangs (drawn on top of skin, but framed so it doesn't block the eyes) ---
    ctx.fillStyle = '#4a3728'; // Ellen: brown hair
    ctx.beginPath();
    ctx.arc(0, -60 + bounce * 0.5, 14, Math.PI, 0); // top dome
    ctx.lineTo(14, -48 + bounce * 0.5); // right side lock
    ctx.quadraticCurveTo(11, -54, 7, -64 + bounce * 0.5); // sweep UP above right eye
    ctx.quadraticCurveTo(0, -61, -7, -64 + bounce * 0.5); // center dip above nose
    ctx.quadraticCurveTo(-11, -54, -14, -48 + bounce * 0.5); // left side lock
    ctx.closePath();
    ctx.fill();

    // --- FACE: Eyes, cheeks, and smile (drawn on top of hair for unblocked visibility) ---
    // Cute eyes
    ctx.fillStyle = '#1e1e2f';
    ctx.beginPath();
    ctx.arc(4, -59 + bounce * 0.5, 2, 0, Math.PI * 2);
    ctx.arc(10, -59 + bounce * 0.5, 2, 0, Math.PI * 2);
    ctx.fill();

    // Cute cheeks (blush)
    ctx.fillStyle = 'rgba(255, 71, 126, 0.4)';
    ctx.beginPath();
    ctx.arc(3, -55 + bounce * 0.5, 2.5, 0, Math.PI * 2);
    ctx.arc(11, -55 + bounce * 0.5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Smiling mouth
    ctx.strokeStyle = '#1e1e2f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(7, -54 + bounce * 0.5, 3, 0.1, Math.PI - 0.1);
    ctx.stroke();

    // --- ACCESSORIES / HEADWEAR ---
    if (outfit === 'graduation') {
      // Cap
      ctx.fillStyle = '#1e1e24';
      ctx.beginPath();
      ctx.moveTo(-18, -74 + bounce * 0.5);
      ctx.lineTo(0, -82 + bounce * 0.5);
      ctx.lineTo(18, -74 + bounce * 0.5);
      ctx.lineTo(0, -66 + bounce * 0.5);
      ctx.closePath();
      ctx.fill();

      // Cap Base
      ctx.fillRect(-8, -69 + bounce * 0.5, 16, 5);

      // Yellow Tassel
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -74 + bounce * 0.5);
      ctx.lineTo(-12, -70 + bounce * 0.5);
      ctx.lineTo(-12, -60 + bounce * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(-14, -60 + bounce * 0.5, 4, 4);
    } else if (outfit === 'wedding') {
      // Veil (Semi-transparent white)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.moveTo(-8, -69 + bounce * 0.5);
      ctx.quadraticCurveTo(-22, -45, -20, -10);
      ctx.lineTo(-6, -20);
      ctx.closePath();
      ctx.fill();

      // Flower crown
      ctx.fillStyle = '#ffccd5';
      ctx.beginPath();
      ctx.arc(-4, -70 + bounce * 0.5, 3, 0, Math.PI*2);
      ctx.arc(1, -72 + bounce * 0.5, 3.5, 0, Math.PI*2);
      ctx.arc(6, -70 + bounce * 0.5, 3, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
  },

  // Draw Husband (Partnership milestones)
  drawHusband(ctx, x, y, outfit, frame, dir, scale = 1) {
    const animFrame = Math.floor(frame) % 24;
    if (this.checkOptimize()) {
      this._drawHusbandDirect(ctx, x, y, outfit, animFrame, dir, scale);
      return;
    }
    const key = `husband_${outfit}_${animFrame}_${scale}`;
    const cachedCanvas = this.getCached(
      key,
      (offscreenCtx) => {
        this._drawHusbandDirect(offscreenCtx, 0, 0, outfit, animFrame, 1, 1);
      },
      80,
      110,
      40,
      95
    );

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.drawImage(cachedCanvas, -40, -95);
    ctx.restore();
  },

  _drawHusbandDirect(ctx, x, y, outfit, frame, dir, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * scale, scale);

    const bounce = Math.sin(frame * 0.15 + 0.5) * 2;
    const walkCycle = Math.sin(frame * 0.25 + 0.5);

    if (outfit === 'kneeling') {
      // Proposing pose
      // Kneeling Leg
      ctx.fillStyle = '#1d3557';
      ctx.fillRect(-12, -10, 16, 6);
      ctx.fillRect(-2, -10, 6, 10);

      // Body (suit)
      ctx.fillStyle = '#1d3557';
      ctx.fillRect(-10, -32, 20, 22);

      // Proposing arm extended
      ctx.fillStyle = '#ffd1ac';
      ctx.fillRect(8, -26, 12, 5); // arm
      // Little red jewelry box
      ctx.fillStyle = '#e63946';
      ctx.fillRect(18, -32, 7, 7);
      ctx.fillStyle = '#ffd166'; // gold ring shine
      ctx.beginPath();
      ctx.arc(21.5, -34, 2, 0, Math.PI*2);
      ctx.fill();

      // Head
      ctx.fillStyle = '#ffd1ac';
      ctx.beginPath();
      ctx.arc(0, -44, 11, 0, Math.PI * 2);
      ctx.fill();

      // Hair (Barney: black hair)
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(0, -46, 12, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-11, -46, 6, 7);

      // Face profile details
      ctx.fillStyle = '#1e1e2f';
      ctx.beginPath();
      ctx.arc(6, -45, 1.5, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeWidth = 1;
      ctx.beginPath();
      ctx.arc(5, -41, 2, 0.1, Math.PI - 0.1);
      ctx.stroke();

      ctx.restore();
      return;
    }

    // --- LEGS ---
    ctx.fillStyle = '#1d3557'; // pants
    // Leg 1
    ctx.save();
    ctx.translate(-6, -15);
    ctx.rotate(walkCycle * 0.4);
    ctx.fillRect(-3.5, 0, 7, 16);
    ctx.fillStyle = '#222'; // shoes
    ctx.fillRect(-4.5, 13, 9, 4.5);
    ctx.restore();

    // Leg 2
    ctx.save();
    ctx.translate(6, -15);
    ctx.rotate(-walkCycle * 0.4);
    ctx.fillRect(-3.5, 0, 7, 16);
    ctx.fillStyle = '#222'; // shoes
    ctx.fillRect(-4.5, 13, 9, 4.5);
    ctx.restore();

    // --- BODY & SUIT/CLOTHES ---
    if (outfit === 'graduation') {
      ctx.fillStyle = '#1e1e24'; // Black gown
      ctx.fillRect(-16, -48 + bounce * 0.3, 32, 38);
      // V-neck stripe (academic hood colors - gold)
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, -48 + bounce * 0.3);
      ctx.lineTo(0, -35 + bounce * 0.3);
      ctx.lineTo(6, -48 + bounce * 0.3);
      ctx.stroke();
    } else if (outfit === 'tuxedo') {
      ctx.fillStyle = '#111115'; // Black jacket
      ctx.fillRect(-14, -48 + bounce * 0.3, 28, 33);
      // White shirt triangle
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-5, -48 + bounce * 0.3);
      ctx.lineTo(5, -48 + bounce * 0.3);
      ctx.lineTo(0, -36 + bounce * 0.3);
      ctx.closePath();
      ctx.fill();
      // Red bow tie
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(-4, -46 + bounce * 0.3);
      ctx.lineTo(4, -42 + bounce * 0.3);
      ctx.lineTo(4, -46 + bounce * 0.3);
      ctx.lineTo(-4, -42 + bounce * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (outfit === 'casual') {
      // Blue t-shirt
      ctx.fillStyle = '#457b9d';
      ctx.fillRect(-13, -48 + bounce * 0.3, 26, 21);
      // Khaki pants
      ctx.fillStyle = '#e9c46a';
      ctx.fillRect(-13, -27 + bounce * 0.3, 26, 12);
    } else if (outfit === 'red_vneck') {
      // Red V-neck t-shirt
      ctx.fillStyle = '#d62828';
      ctx.fillRect(-13, -48 + bounce * 0.3, 26, 21);
      // V-neck cut
      ctx.fillStyle = '#ffd1ac'; // skin showing through
      ctx.beginPath();
      ctx.moveTo(-4, -48 + bounce * 0.3);
      ctx.lineTo(4, -48 + bounce * 0.3);
      ctx.lineTo(0, -40 + bounce * 0.3);
      ctx.closePath();
      ctx.fill();
      // Dark jeans
      ctx.fillStyle = '#1d3557';
      ctx.fillRect(-13, -27 + bounce * 0.3, 26, 12);
    } else if (outfit === 'flannel') {
      // Flannel shirt (plaid pattern) — cozy first-home vibe
      ctx.fillStyle = '#8b2500';
      ctx.fillRect(-13, -48 + bounce * 0.3, 26, 21);
      // Plaid stripes
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (let sx = -13; sx <= 13; sx += 6) {
        ctx.fillRect(sx, -48 + bounce * 0.3, 2, 21);
      }
      ctx.fillStyle = 'rgba(255,200,100,0.12)';
      for (let sy = -48; sy <= -27; sy += 5) {
        ctx.fillRect(-13, sy + bounce * 0.3, 26, 1.5);
      }
      // Khaki pants
      ctx.fillStyle = '#b5a67d';
      ctx.fillRect(-13, -27 + bounce * 0.3, 26, 12);
    } else if (outfit === 'suit') {
      // Smart navy suit for the engagement
      ctx.fillStyle = '#1d3557';
      ctx.fillRect(-14, -48 + bounce * 0.3, 28, 33);
      // White shirt + tie
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-3, -48 + bounce * 0.3, 6, 20);
      ctx.fillStyle = '#e63946'; // red tie
      ctx.fillRect(-1.5, -46 + bounce * 0.3, 3, 16);
      // Tie knot
      ctx.beginPath();
      ctx.moveTo(-3, -46 + bounce * 0.3);
      ctx.lineTo(3, -46 + bounce * 0.3);
      ctx.lineTo(0, -43 + bounce * 0.3);
      ctx.closePath();
      ctx.fill();
    } else if (outfit === 'dad_casual') {
      // Relaxed polo shirt
      ctx.fillStyle = '#588157'; // olive green polo
      ctx.fillRect(-13, -48 + bounce * 0.3, 26, 21);
      // Polo collar
      ctx.fillStyle = '#3a5a40';
      ctx.fillRect(-6, -48 + bounce * 0.3, 12, 3);
      // Comfortable chinos
      ctx.fillStyle = '#dda15e';
      ctx.fillRect(-13, -27 + bounce * 0.3, 26, 12);
    } else if (outfit === 'hiking') {
      // Red vest / shirt
      ctx.fillStyle = '#e63946';
      ctx.fillRect(-14, -48 + bounce * 0.3, 28, 22);
      // Pants
      ctx.fillStyle = '#264653';
      ctx.fillRect(-12, -26 + bounce * 0.3, 24, 11);
    }

    // --- ARMS ---
    ctx.fillStyle = '#ffd1ac';
    // Arm 1 (back)
    ctx.save();
    ctx.translate(-11, -44 + bounce * 0.3);
    ctx.rotate(-walkCycle * 0.3);
    ctx.fillStyle = outfit === 'graduation' ? '#1e1e24' :
                   (outfit === 'tuxedo' ? '#111115' :
                   (outfit === 'suit' ? '#1d3557' :
                   (outfit === 'red_vneck' ? '#d62828' :
                   (outfit === 'flannel' ? '#8b2500' :
                   (outfit === 'dad_casual' ? '#588157' :
                   (outfit === 'hiking' ? '#e63946' : '#457b9d'))))));
    ctx.fillRect(-3, 0, 6, 19);
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(0, 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Arm 2 (front)
    ctx.save();
    ctx.translate(11, -44 + bounce * 0.3);
    ctx.rotate(walkCycle * 0.3);
    ctx.fillStyle = outfit === 'graduation' ? '#1e1e24' :
                   (outfit === 'tuxedo' ? '#111115' :
                   (outfit === 'suit' ? '#1d3557' :
                   (outfit === 'red_vneck' ? '#d62828' :
                   (outfit === 'flannel' ? '#8b2500' :
                   (outfit === 'dad_casual' ? '#588157' :
                   (outfit === 'hiking' ? '#e63946' : '#457b9d'))))));
    ctx.fillRect(-3, 0, 6, 19);
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(0, 20, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // --- HEAD & FACE ---
    ctx.fillStyle = '#ffd1ac'; // Skin tone
    ctx.beginPath();
    ctx.arc(0, -61 + bounce * 0.5, 12.5, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1e1e2f';
    ctx.beginPath();
    ctx.arc(4, -62 + bounce * 0.5, 1.8, 0, Math.PI * 2);
    ctx.arc(9, -62 + bounce * 0.5, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#1e1e2f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(6.5, -57 + bounce * 0.5, 3, 0.1, Math.PI - 0.1);
    ctx.stroke();

    // --- HAIR ---
    ctx.fillStyle = '#1a1a1a'; // Barney: black hair
    ctx.beginPath();
    ctx.arc(0, -63 + bounce * 0.5, 13.5, Math.PI, 0);
    ctx.fill();
    // Sideburns / top sweep
    ctx.fillRect(-13, -63 + bounce * 0.5, 6, 8);

    // --- ACCESSORIES ---
    if (outfit === 'graduation') {
      // Cap
      ctx.fillStyle = '#1e1e24';
      ctx.beginPath();
      ctx.moveTo(-18, -74 + bounce * 0.5);
      ctx.lineTo(0, -82 + bounce * 0.5);
      ctx.lineTo(18, -74 + bounce * 0.5);
      ctx.lineTo(0, -66 + bounce * 0.5);
      ctx.closePath();
      ctx.fill();

      // Cap Base
      ctx.fillRect(-8, -69 + bounce * 0.5, 16, 5);

      // Yellow Tassel
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -74 + bounce * 0.5);
      ctx.lineTo(-12, -70 + bounce * 0.5);
      ctx.lineTo(-12, -60 + bounce * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(-14, -60 + bounce * 0.5, 4, 4);
    }

    ctx.restore();
  },

  // Draw Dog
  drawDog(ctx, x, y, frame, dir, scale = 0.75) {
    const animFrame = Math.floor(frame) % 24;
    if (this.checkOptimize()) {
      this._drawDogDirect(ctx, x, y, animFrame, dir, scale);
      return;
    }
    const key = `dog_${animFrame}_${scale}`;
    const cachedCanvas = this.getCached(
      key,
      (offscreenCtx) => {
        this._drawDogDirect(offscreenCtx, 0, 0, animFrame, 1, 1);
      },
      80,
      80,
      40,
      70
    );

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * scale, scale);
    ctx.drawImage(cachedCanvas, -40, -70);
    ctx.restore();
  },

  _drawDogDirect(ctx, x, y, frame, dir, scale = 0.75) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * scale, scale);

    const tailWag = Math.sin(frame * 0.4) * 0.3;
    const legSwing = Math.sin(frame * 0.3);
    const bounce = Math.sin(frame * 0.15) * 1;

    // Color: White fluffy shih tzu (Mochi)
    const white = '#ffffff';
    const patchColor = '#e5dec9'; // very light tan patches

    // Tail (curled fluffy tail over back)
    ctx.save();
    ctx.translate(-14, -14 + bounce);
    ctx.rotate(-0.8 + tailWag);
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI*2);
    ctx.arc(-5, -3, 5, 0, Math.PI*2);
    ctx.arc(-2, -6, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Fluffy legs
    const drawLeg = (lx, ly, rotation) => {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(rotation);
      ctx.fillStyle = white;
      ctx.fillRect(-3.5, 0, 7, 9);
      ctx.beginPath();
      ctx.arc(0, 8.5, 3.8, 0, Math.PI, true);
      ctx.fill();
      ctx.restore();
    };

    drawLeg(-9, -5, legSwing * 0.35);
    drawLeg(-4, -5, -legSwing * 0.35);
    drawLeg(5, -5, legSwing * 0.35);
    drawLeg(10, -5, -legSwing * 0.35);

    // Fluffy body
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(-8, -12 + bounce, 9.5, 0, Math.PI*2);
    ctx.arc(1, -12 + bounce, 9.5, 0, Math.PI*2);
    ctx.arc(7, -12 + bounce, 8.5, 0, Math.PI*2);
    ctx.fill();
    
    // Light tan patch on back
    ctx.fillStyle = patchColor;
    ctx.beginPath();
    ctx.arc(-1, -13 + bounce, 6, 0, Math.PI*2);
    ctx.fill();

    // Head (fluffy shih tzu head & beard)
    ctx.save();
    ctx.translate(11, -20 + bounce);
    
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI*2); // skull
    ctx.arc(-3, 3, 5.5, 0, Math.PI*2); // cheeks/beard
    ctx.arc(3, 3, 5.5, 0, Math.PI*2);
    ctx.arc(0, 5, 5.5, 0, Math.PI*2); // beard chin
    ctx.fill();

    // Ear patches
    ctx.fillStyle = patchColor;
    ctx.beginPath();
    ctx.arc(-6, -1, 4, 0, Math.PI*2);
    ctx.fill();
    
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.moveTo(-5, -5);
    ctx.quadraticCurveTo(-9, 2, -6, 6);
    ctx.quadraticCurveTo(-3, 5, -3, -1);
    ctx.closePath();
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(2, -1.8, 1.8, 0, Math.PI*2);
    ctx.arc(7, -1.8, 1.8, 0, Math.PI*2);
    ctx.fill();
    
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(2.5, -2.3, 0.6, 0, Math.PI*2);
    ctx.arc(7.5, -2.3, 0.6, 0, Math.PI*2);
    ctx.fill();

    // Nose
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(4.5, 1, 1.6, 0, Math.PI*2);
    ctx.fill();

    // Pink tongue peeking out
    ctx.fillStyle = '#ff7096';
    ctx.beginPath();
    ctx.arc(4.5, 3.8, 1.2, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  },

  // Draw Toddler / Kids
  drawKid(ctx, x, y, type, frame, dir, lvlIdx = 9) {
    const animFrame = Math.floor(frame) % 24;
    if (this.checkOptimize()) {
      this._drawKidDirect(ctx, x, y, type, animFrame, dir, lvlIdx);
      return;
    }
    const key = `kid_${type}_${animFrame}_${lvlIdx}`;
    const cachedCanvas = this.getCached(
      key,
      (offscreenCtx) => {
        this._drawKidDirect(offscreenCtx, 0, 0, type, animFrame, 1, lvlIdx);
      },
      110,
      110,
      55,
      95
    );

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.drawImage(cachedCanvas, -55, -95);
    ctx.restore();
  },

  _drawKidDirect(ctx, x, y, type, frame, dir, lvlIdx = 9) {
    let scale = 0.6;
    if (type === 'kid1') {
      scale = (lvlIdx >= 8) ? 0.78 : 0.55; // Preston grows taller when Blaire starts walking in Level 9 & 10!
    } else if (type === 'kid2') {
      scale = 0.48; // Blaire walking toddler
    } else if (type === 'baby_crawling') {
      scale = 0.52; // Blaire crawling baby
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * scale, scale);

    const bounce = Math.sin(frame * 0.18) * 1.5;
    const walkCycle = Math.sin(frame * 0.28);

    if (type === 'baby_stroller') {
      // Draw Stroller in BLUE for Preston 🍼💙
      ctx.fillStyle = '#4ea8de'; // Blue hood
      ctx.beginPath();
      ctx.arc(-4, -26, 16, Math.PI, Math.PI * 1.6);
      ctx.lineTo(-4, -10);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#0077b6'; // Blue bassinet body
      ctx.fillRect(-22, -16, 26, 12);

      // Handle
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-22, -12);
      ctx.lineTo(-30, -26);
      ctx.lineTo(-34, -26);
      ctx.stroke();

      // Wheels
      ctx.fillStyle = '#333333';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-14, -2, 6, 0, Math.PI * 2);
      ctx.arc(2, -2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
      return;
    }

    if (type === 'baby_crawling') {
      // Crawling baby Blaire at Level 8 👶🍼
      const crawlCycle = Math.sin(frame * 0.22);
      ctx.save();
      ctx.translate(0, Math.abs(crawlCycle) * 1.5); // crawling bobbing

      // Diaper/pants
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-8, -4, 5.5, 0, Math.PI*2);
      ctx.fill();

      // Body (Onesie - Pink)
      ctx.fillStyle = '#ffccd5';
      ctx.fillRect(-12, -11, 16, 8);

      // Head
      ctx.fillStyle = '#ffd1ac';
      ctx.beginPath();
      ctx.arc(7, -12, 6.5, 0, Math.PI*2);
      ctx.fill();

      // Eye
      ctx.fillStyle = '#1e1e2f';
      ctx.beginPath();
      ctx.arc(9, -13, 1.2, 0, Math.PI*2);
      ctx.fill();

      // Smile
      ctx.strokeStyle = '#1e1e2f';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(8.5, -10, 1.8, 0.1, Math.PI - 0.1);
      ctx.stroke();

      // Hair
      ctx.fillStyle = '#4a3728';
      ctx.beginPath();
      ctx.arc(6, -14, 7, Math.PI * 1.1, Math.PI * 1.9);
      ctx.fill();

      // Ponytail with Pink Bow
      ctx.fillStyle = '#ff477e';
      ctx.beginPath();
      ctx.arc(2, -18, 2, 0, Math.PI*2);
      ctx.fill();

      // Limbs
      ctx.strokeStyle = '#ffd1ac';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';

      // Back leg
      ctx.beginPath();
      ctx.moveTo(-10, -3);
      ctx.lineTo(-8 + crawlCycle * 2.5, 1);
      ctx.stroke();

      // Front arm
      ctx.beginPath();
      ctx.moveTo(3, -4);
      ctx.lineTo(5 - crawlCycle * 2.5, 0);
      ctx.stroke();

      ctx.restore();
      ctx.restore();
      return;
    }

    // Walking kids (Preston = kid1, Blaire = kid2)
    // Legs
    ctx.fillStyle = '#1e293b'; // pants
    ctx.save();
    ctx.translate(-4, -10);
    ctx.rotate(walkCycle * 0.4);
    ctx.fillRect(-2, 0, 4, 11);
    ctx.fillStyle = '#e76f51'; // shoes
    ctx.fillRect(-3, 9, 6, 2.5);
    ctx.restore();

    ctx.save();
    ctx.translate(4, -10);
    ctx.rotate(-walkCycle * 0.4);
    ctx.fillRect(-2, 0, 4, 11);
    ctx.fillStyle = '#e76f51'; // shoes
    ctx.fillRect(-3, 9, 6, 2.5);
    ctx.restore();

    // Body (Preston has Blue Shirt, Blaire has Pink Dress)
    if (type === 'kid1') {
      // Preston (Blue Shirt, pants)
      ctx.fillStyle = '#0077b6'; // Blue
      ctx.fillRect(-9, -30 + bounce * 0.3, 18, 20);
    } else {
      // Blaire (Pink dress skirt shape)
      ctx.fillStyle = '#ff7096'; // Pink
      ctx.beginPath();
      ctx.moveTo(-8, -30 + bounce * 0.3);
      ctx.lineTo(8, -30 + bounce * 0.3);
      ctx.lineTo(12, -10 + bounce * 0.3);
      ctx.lineTo(-12, -10 + bounce * 0.3);
      ctx.closePath();
      ctx.fill();
    }

    // Arms
    ctx.fillStyle = '#ffd1ac';
    ctx.save();
    ctx.translate(-7, -27 + bounce * 0.3);
    ctx.rotate(-walkCycle * 0.3);
    ctx.fillRect(-2, 0, 4, 12);
    ctx.restore();

    ctx.save();
    ctx.translate(7, -27 + bounce * 0.3);
    ctx.rotate(walkCycle * 0.3);
    ctx.fillRect(-2, 0, 4, 12);
    ctx.restore();

    // Head
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(0, -40 + bounce * 0.5, 9, 0, Math.PI*2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#1e1e2f';
    ctx.beginPath();
    ctx.arc(2, -41 + bounce * 0.5, 1.2, 0, Math.PI*2);
    ctx.arc(6, -41 + bounce * 0.5, 1.2, 0, Math.PI*2);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#1e1e2f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(4, -37 + bounce * 0.5, 2, 0.1, Math.PI - 0.1);
    ctx.stroke();

    // Hair
    ctx.fillStyle = '#4a3728'; // Brown
    ctx.beginPath();
    ctx.arc(0, -42 + bounce * 0.5, 9.5, Math.PI, 0);
    ctx.fill();

    if (type === 'kid2') {
      // Blaire's little ponytail with pink bow
      ctx.fillStyle = '#ff477e';
      ctx.beginPath();
      ctx.arc(-7, -45 + bounce * 0.5, 2.5, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#4a3728';
      ctx.beginPath();
      ctx.arc(-9, -43 + bounce * 0.5, 2, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.restore();
  },

  // Draw Heart (Collectible Item)
  // Draw floating balloons cluster for engagement level
  drawBalloons(ctx, baseX, baseY, time) {
    const balloonDefs = [
      // [offsetX, offsetY, color, phase] — spread around the gazebo
      [-90, -130, '#e63946', 0.0],   // red left far
      [-65, -160, '#ff6b8a', 0.7],   // pink left
      [-40, -145, '#f4a261', 1.4],   // orange left-center
      [-20, -175, '#e76f51', 2.1],   // coral left-of-center
      [  0, -185, '#ff477e', 2.8],   // hot-pink center
      [ 20, -170, '#d62828', 3.5],   // deep-red center-right
      [ 40, -150, '#fcbf49', 0.3],   // gold right-center
      [ 65, -165, '#ff9a9e', 1.0],   // salmon right
      [ 90, -135, '#e63946', 1.7],   // red right far
      [-50, -190, '#ff85a1', 2.4],   // rose high-left
      [ 50, -195, '#f28482', 3.1],   // blush high-right
      [  0, -210, '#d62828', 0.5],   // deep-red top-center
    ];

    ctx.save();
    ctx.translate(baseX, baseY);

    balloonDefs.forEach(([ox, oy, color, phase]) => {
      const bob = Math.sin(time * 0.002 + phase) * 6;
      const sway = Math.sin(time * 0.0015 + phase * 1.3) * 4;
      const bx = ox + sway;
      const by = oy + bob;

      // String
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(bx, by + 14);
      ctx.quadraticCurveTo(bx + sway * 0.5, by + 35, bx - sway * 0.3, by + 50);
      ctx.stroke();

      // Balloon body (oval)
      ctx.save();
      ctx.translate(bx, by);
      ctx.scale(1, 1.25);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Highlight/shine
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(bx - 3, by - 4, 3, 2, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Knot at bottom
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(bx - 2, by + 12);
      ctx.lineTo(bx + 2, by + 12);
      ctx.lineTo(bx, by + 16);
      ctx.closePath();
      ctx.fill();
    });

    ctx.restore();
  },

  drawHeart(ctx, x, y, frame) {
    ctx.save();
    ctx.translate(x, y + Math.sin(frame * 0.1) * 3);
    
    ctx.fillStyle = '#ff477e';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    // Left curve
    ctx.bezierCurveTo(-6, -6, -12, 0, 0, 10);
    // Right curve
    ctx.bezierCurveTo(12, 0, 6, -6, 0, 0);
    ctx.fill();

    // Inner glow dot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.beginPath();
    ctx.arc(-3, -2, 1.5, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
  },

  // Draw Jump Hurdle Obstacles
  drawHurdle(ctx, x, y, levelId) {
    ctx.save();
    ctx.translate(x, y);

    switch(levelId) {
      case 1: // Graduation: Stack of textbooks
        ctx.fillStyle = '#457b9d';
        ctx.fillRect(-15, -6, 30, 6);
        ctx.fillStyle = '#e63946';
        ctx.fillRect(-12, -12, 24, 6);
        ctx.fillStyle = '#e9c46a';
        ctx.fillRect(-14, -18, 28, 6);
        // Pages lines
        ctx.fillStyle = '#f1faee';
        ctx.fillRect(-13, -5, 28, 4);
        ctx.fillRect(-11, -11, 22, 4);
        ctx.fillRect(-13, -17, 26, 4);
        break;
      case 2: // Dog: Basket of tennis balls / dog toys
        ctx.fillStyle = '#d4a373';
        ctx.fillRect(-16, -14, 32, 14); // basket
        // rim
        ctx.fillStyle = '#a67c52';
        ctx.fillRect(-18, -16, 36, 3);
        // Tennis balls
        ctx.fillStyle = '#adff2f';
        ctx.beginPath();
        ctx.arc(-8, -16, 5, 0, Math.PI*2);
        ctx.arc(0, -18, 5, 0, Math.PI*2);
        ctx.arc(8, -16, 5, 0, Math.PI*2);
        ctx.fill();
        break;
      case 3: // Engagement: Proposal gift box
        ctx.fillStyle = '#ff7096';
        ctx.fillRect(-12, -16, 24, 16);
        ctx.fillStyle = '#fff'; // ribbon
        ctx.fillRect(-3, -17, 6, 17);
        ctx.fillRect(-13, -9, 26, 3);
        ctx.font = '12px sans-serif';
        ctx.fillText('🎀', -8, -17);
        break;
      case 4: // Wedding: Wedding cake
        ctx.fillStyle = '#fff';
        ctx.fillRect(-20, -10, 40, 10);
        ctx.fillStyle = '#ffe5ec';
        ctx.fillRect(-14, -20, 28, 10);
        ctx.fillStyle = '#ffccd5';
        ctx.fillRect(-8, -28, 16, 8);
        // Cake stand
        ctx.fillStyle = '#ddd';
        ctx.fillRect(-22, 0, 44, 2);
        // Heart topper
        ctx.fillStyle = '#ff477e';
        ctx.beginPath();
        ctx.arc(0, -32, 2, 0, Math.PI*2);
        ctx.fill();
        break;
      case 5: // First Home: Cardboard moving boxes
        ctx.fillStyle = '#c5a880';
        ctx.fillRect(-16, -16, 32, 16); // big box
        ctx.fillStyle = '#9c805c'; // tape
        ctx.fillRect(-16, -9, 32, 2);
        ctx.fillStyle = '#b4966e';
        ctx.fillRect(4, -30, 20, 14); // small box
        ctx.fillStyle = '#9c805c';
        ctx.fillRect(4, -24, 20, 2);
        break;
      case 6: // First Child: Stack of toy alphabet blocks
        const drawBlock = (bx, by, size, color, letter) => {
          ctx.fillStyle = color;
          ctx.fillRect(bx, by, size, size);
          ctx.strokeStyle = 'rgba(0,0,0,0.15)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx+1, by+1, size-2, size-2);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(letter, bx + size/2, by + size/2 + 3);
        };
        drawBlock(-18, -12, 12, '#e63946', 'A');
        drawBlock(-6, -12, 12, '#457b9d', 'B');
        drawBlock(6, -12, 12, '#e9c46a', 'C');
        drawBlock(-12, -24, 12, '#50c878', '1');
        drawBlock(0, -24, 12, '#ff9f1c', '2');
        break;
      case 7: // Second House: Garden Wheelbarrow
        ctx.fillStyle = '#4ea8de'; // tray
        ctx.beginPath();
        ctx.moveTo(-16, -14);
        ctx.lineTo(12, -14);
        ctx.lineTo(6, -4);
        ctx.lineTo(-12, -4);
        ctx.closePath();
        ctx.fill();
        // wheel
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(12, -2, 4, 0, Math.PI*2);
        ctx.fill();
        // frame/handles
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-22, -10);
        ctx.lineTo(-12, -4);
        ctx.lineTo(12, -2);
        ctx.stroke();
        break;
      case 8: // Second Child: Kid's Toy Tricycle
        // Wheels
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(-12, -4, 4, 0, Math.PI*2);
        ctx.arc(10, -5, 5.5, 0, Math.PI*2);
        ctx.fill();
        // Frame
        ctx.strokeStyle = '#e63946';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-12, -4);
        ctx.lineTo(-2, -5);
        ctx.lineTo(10, -5); // main beam
        ctx.moveTo(-2, -5);
        ctx.lineTo(-2, -16); // seat post
        ctx.moveTo(10, -5);
        ctx.lineTo(8, -18); // fork
        ctx.stroke();
        // Seat
        ctx.fillStyle = '#000';
        ctx.fillRect(-6, -18, 9, 3);
        // Handlebars
        ctx.strokeStyle = '#000';
        ctx.beginPath();
        ctx.moveTo(5, -18);
        ctx.lineTo(11, -18);
        ctx.stroke();
        break;
      case 9: // Camping: Campfire pit with logs & flames
        // Logs
        ctx.fillStyle = '#5c4033';
        ctx.save();
        ctx.rotate(0.2);
        ctx.fillRect(-15, -4, 30, 5);
        ctx.restore();
        ctx.save();
        ctx.rotate(-0.2);
        ctx.fillRect(-15, -4, 30, 5);
        ctx.restore();

        // Rocks ring
        ctx.fillStyle = '#888';
        for (let i = -16; i <= 16; i += 8) {
          ctx.beginPath();
          ctx.arc(i, 0, 4, 0, Math.PI*2);
          ctx.fill();
        }

        // Animated flames
        const flameHeight = 15 + Math.sin(Date.now() * 0.02) * 5;
        ctx.fillStyle = '#ff5400'; // outer flame
        ctx.beginPath();
        ctx.moveTo(-8, -2);
        ctx.quadraticCurveTo(-10, -flameHeight, 0, -flameHeight - 5);
        ctx.quadraticCurveTo(10, -flameHeight, 8, -2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffbd00'; // inner flame
        ctx.beginPath();
        ctx.moveTo(-5, -2);
        ctx.quadraticCurveTo(-6, -flameHeight + 6, 0, -flameHeight);
        ctx.quadraticCurveTo(6, -flameHeight + 6, 5, -2);
        ctx.closePath();
        ctx.fill();
        break;
      case 11: // Started Dating: Bouquet of roses
        // Stems
        ctx.strokeStyle = '#2e7d32';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(-6, -14);
        ctx.moveTo(0, 0); ctx.lineTo(0, -16);
        ctx.moveTo(0, 0); ctx.lineTo(6, -14);
        ctx.stroke();
        // Roses
        ctx.fillStyle = '#ff477e';
        [[-6, -16], [0, -18], [6, -16]].forEach(p => {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 5, 0, Math.PI * 2);
          ctx.fill();
        });
        // Paper wrap
        ctx.fillStyle = '#ffd6e0';
        ctx.beginPath();
        ctx.moveTo(-7, -2); ctx.lineTo(7, -2); ctx.lineTo(4, -12); ctx.lineTo(-4, -12);
        ctx.closePath();
        ctx.fill();
        break;
      default:
        break;
    }

    ctx.restore();
  },

  // Draw Background Parallax Scenery
  drawScenery(ctx, levelId, stageX, time) {
    if (this.checkOptimize()) {
      this._drawSceneryDirect(ctx, levelId, stageX, time);
      return;
    }
    if (levelId === 10) {
      const fujiKey = `fuji_scenery`;
      const cachedFuji = this.getCached(
        fujiKey,
        (offscreenCtx) => {
          this.drawFuji(offscreenCtx, 0, 0, 680, 370);
        },
        720,
        380,
        360,
        370
      );

      ctx.save();
      ctx.translate(stageX, 420);
      ctx.drawImage(cachedFuji, -360, -370);
      ctx.restore();

      ctx.save();
      ctx.translate(0, 420);
      this.drawCherryBranch(ctx, stageX - 120, -260, time);
      ctx.restore();
      return;
    }

    // Engagement level: draw animated balloons outside the cache
    if (levelId === 3) {
      const key3 = `scenery_3`;
      const cachedGazebo = this.getCached(
        key3,
        (offscreenCtx) => {
          this._drawSceneryDirect(offscreenCtx, 3, 0, 0);
        },
        400,
        460,
        200,
        0
      );
      ctx.save();
      ctx.translate(stageX, 420);
      ctx.drawImage(cachedGazebo, -200, -420);
      ctx.restore();

      // Animated balloons (not cached so they bob/sway)
      ctx.save();
      ctx.translate(0, 420);
      this.drawBalloons(ctx, stageX, 0, time);
      ctx.restore();
      return;
    }

    const key = `scenery_${levelId}`;
    // _drawSceneryDirect anchors itself to ground level (translate y=420), so the
    // offscreen cache must be tall enough to contain that and use anchorY=0 — a
    // non-zero anchorY here double-translates the scenery off-canvas (blank landmark).
    const cachedScenery = this.getCached(
      key,
      (offscreenCtx) => {
        this._drawSceneryDirect(offscreenCtx, levelId, 0, 0);
      },
      400,
      460,
      200,
      0
    );

    ctx.save();
    ctx.translate(stageX, 420);
    ctx.drawImage(cachedScenery, -200, -420);
    ctx.restore();
  },

  _drawSceneryDirect(ctx, levelId, stageX, time) {
    ctx.save();
    ctx.translate(0, 420); // Translate to ground level (y = 420)

    switch(levelId) {
      case 1: // Graduation: University Columns
        ctx.fillStyle = '#dcdcdc';
        // Base
        ctx.fillRect(stageX - 100, -8, 200, 8);
        // Columns
        ctx.fillRect(stageX - 80, -140, 16, 132);
        ctx.fillRect(stageX - 30, -140, 16, 132);
        ctx.fillRect(stageX + 14, -140, 16, 132);
        ctx.fillRect(stageX + 64, -140, 16, 132);
        // Pediment (Top triangle)
        ctx.beginPath();
        ctx.moveTo(stageX - 100, -140);
        ctx.lineTo(stageX, -180);
        ctx.lineTo(stageX + 100, -140);
        ctx.closePath();
        ctx.fill();
        break;

      case 2: // Dog: Doghouse and fence
        // Fence
        ctx.strokeStyle = '#f1faee';
        ctx.lineWidth = 4;
        for (let fx = stageX - 120; fx <= stageX + 120; fx += 25) {
          ctx.beginPath();
          ctx.moveTo(fx, 0);
          ctx.lineTo(fx, -40);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(stageX - 130, -28);
        ctx.lineTo(stageX + 130, -28);
        ctx.stroke();

        // Dog house
        ctx.fillStyle = '#9c6644';
        ctx.fillRect(stageX - 30, -50, 60, 50); // body
        // Roof
        ctx.fillStyle = '#7f5539';
        ctx.beginPath();
        ctx.moveTo(stageX - 38, -50);
        ctx.lineTo(stageX, -74);
        ctx.lineTo(stageX + 38, -50);
        ctx.closePath();
        ctx.fill();
        // Door opening
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(stageX, -15, 12, Math.PI, 0);
        ctx.lineTo(stageX + 12, 0);
        ctx.lineTo(stageX - 12, 0);
        ctx.closePath();
        ctx.fill();
        break;

      case 3: // Engagement: Romantic Gazebo
        ctx.fillStyle = '#eae2b7';
        // Base
        ctx.fillRect(stageX - 60, -10, 120, 10);
        // Pillars
        ctx.fillStyle = '#d62828';
        ctx.fillRect(stageX - 50, -90, 8, 80);
        ctx.fillRect(stageX + 42, -90, 8, 80);
        ctx.fillRect(stageX - 15, -90, 4, 80);
        ctx.fillRect(stageX + 11, -90, 4, 80);
        // Roof dome
        ctx.fillStyle = '#003049';
        ctx.beginPath();
        ctx.arc(stageX, -90, 54, Math.PI, 0);
        ctx.fill();
        // Light strings glow effect
        ctx.fillStyle = 'rgba(252, 191, 73, 0.4)';
        for (let lx = stageX - 40; lx <= stageX + 40; lx += 16) {
          ctx.beginPath();
          ctx.arc(lx, -80, 6, 0, Math.PI*2);
          ctx.fill();
        }
        break;

      case 4: // Wedding: Floral Archway
        // Pillars
        ctx.strokeStyle = '#f8f9fa';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(stageX - 50, 0);
        ctx.quadraticCurveTo(stageX - 50, -120, stageX, -120);
        ctx.quadraticCurveTo(stageX + 50, -120, stageX + 50, 0);
        ctx.stroke();

        // Rose flowers detailing
        ctx.fillStyle = '#ff477e';
        const flowerCoords = [
          [-50, -30], [-48, -70], [-38, -100], [0, -122],
          [38, -100], [48, -70], [50, -30], [-20, -116], [20, -116]
        ];
        flowerCoords.forEach(c => {
          ctx.beginPath();
          ctx.arc(stageX + c[0], c[1], 8, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(stageX + c[0], c[1], 3, 0, Math.PI*2);
          ctx.fill();
          ctx.fillStyle = '#ff7096';
        });
        break;

      case 5: // First House
        this.drawHouse(ctx, stageX, 0, 'first', 0.95);
        break;

      case 6: // Baby Nursery window silhouette / room
        // Draw inside view of cozy room (Window frame silhouette)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(stageX - 80, -110, 160, 110);
        // Wall paper vertical stripes
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 2;
        for (let wx = stageX - 70; wx < stageX + 80; wx += 20) {
          ctx.beginPath();
          ctx.moveTo(wx, -110);
          ctx.lineTo(wx, 0);
          ctx.stroke();
        }
        // Baby Crib silhouette
        ctx.fillStyle = '#cca43b';
        ctx.fillRect(stageX - 45, -30, 90, 30);
        // Bars
        ctx.fillStyle = '#e5c060';
        for (let bx = stageX - 40; bx <= stageX + 40; bx += 8) {
          ctx.fillRect(bx, -28, 2, 28);
        }
        ctx.fillRect(stageX - 47, -32, 94, 4);
        break;

      case 7: // Second House
        this.drawHouse(ctx, stageX, 0, 'second', 1.1);
        break;

      case 8: // Playground / Family Park
        // Swing set
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Left A-frame
        ctx.moveTo(stageX - 60, 0);
        ctx.lineTo(stageX - 45, -80);
        ctx.lineTo(stageX - 30, 0);
        // Right A-frame
        ctx.moveTo(stageX + 30, 0);
        ctx.lineTo(stageX + 45, -80);
        ctx.lineTo(stageX + 60, 0);
        // Crossbar
        ctx.moveTo(stageX - 48, -78);
        ctx.lineTo(stageX + 48, -78);
        ctx.stroke();

        // Swing ropes and seat
        ctx.strokeStyle = '#aaa';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(stageX - 10, -78); ctx.lineTo(stageX - 10, -25);
        ctx.moveTo(stageX + 10, -78); ctx.lineTo(stageX + 10, -25);
        ctx.stroke();
        // Seat
        ctx.fillStyle = '#e76f51';
        ctx.fillRect(stageX - 14, -25, 28, 3);
        break;

      case 9: // Camping RV
        this.drawRV(ctx, stageX, 0, 1.25);
        break;

      case 10: // Mt Fuji and Cherry Blossom
        this.drawFuji(ctx, stageX, 0, 680, 370); // Larger and more majestic!
        // Cherry blossoms branch framing the view
        this.drawCherryBranch(ctx, stageX - 120, -260, time);
        break;

      case 11: // Started Dating: Park bench under a blossom tree
        // Tree trunk
        ctx.fillStyle = '#8b5a2b';
        ctx.fillRect(stageX - 60, -78, 10, 78);
        // Blossom canopy
        ctx.fillStyle = '#ffc8dd';
        [[-55, -86, 26], [-72, -72, 20], [-38, -72, 20], [-55, -60, 16]].forEach(c => {
          ctx.beginPath();
          ctx.arc(stageX + c[0], c[1], c[2], 0, Math.PI * 2);
          ctx.fill();
        });
        // Park bench
        ctx.fillStyle = '#6b4f3a';
        ctx.fillRect(stageX + 6, -24, 72, 6);   // seat
        ctx.fillRect(stageX + 8, -46, 72, 5);   // backrest
        ctx.fillRect(stageX + 12, -24, 5, 24);  // front legs
        ctx.fillRect(stageX + 71, -24, 5, 24);
        ctx.fillRect(stageX + 12, -46, 4, 22);  // back supports
        ctx.fillRect(stageX + 72, -46, 4, 22);
        // Floating hearts
        ctx.fillStyle = '#ff5d8f';
        [[-8, -96], [22, -110], [-30, -116]].forEach(h => {
          const hy = h[1] + Math.sin(time + h[0]) * 4;
          ctx.beginPath();
          ctx.arc(stageX + h[0] - 4, hy, 4, Math.PI, 0);
          ctx.arc(stageX + h[0] + 4, hy, 4, Math.PI, 0);
          ctx.lineTo(stageX + h[0], hy + 8);
          ctx.closePath();
          ctx.fill();
        });
        break;

      default:
        break;
    }

    ctx.restore();
  },

  // Draw first cozy home
  drawHouse(ctx, x, y, type, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    if (type === 'first') {
      // First Home (small, cozy)
      // Body (blue — matches the real first home photo)
      ctx.fillStyle = '#5b8fb3';
      ctx.fillRect(-50, -60, 100, 60);

      // Roof (dark blue-grey tiles)
      ctx.fillStyle = '#364f6b';
      ctx.beginPath();
      ctx.moveTo(-60, -60);
      ctx.lineTo(0, -96);
      ctx.lineTo(60, -60);
      ctx.closePath();
      ctx.fill();

      // Chimney
      ctx.fillStyle = '#7d4f50';
      ctx.fillRect(30, -85, 12, 25);
      ctx.fillStyle = '#333';
      ctx.fillRect(28, -87, 16, 4);

      // Door (Yellow)
      ctx.fillStyle = '#fcbf49';
      ctx.fillRect(-12, -32, 24, 32);
      ctx.fillStyle = '#000'; // doorknob
      ctx.beginPath();
      ctx.arc(8, -16, 2, 0, Math.PI*2);
      ctx.fill();

      // Windows
      ctx.fillStyle = '#e2ece9';
      ctx.strokeStyle = '#364f6b';
      ctx.lineWidth = 3;
      // Window Left
      ctx.fillRect(-36, -45, 18, 18);
      ctx.strokeRect(-36, -45, 18, 18);
      // Window Right
      ctx.fillRect(18, -45, 18, 18);
      ctx.strokeRect(18, -45, 18, 18);
    } else {
      // Second Home (larger suburban with nice details)
      // Body (warm red — matches the real second home photo)
      ctx.fillStyle = '#c15b42';
      ctx.fillRect(-70, -75, 140, 75);
      // Garage extension (deeper red)
      ctx.fillStyle = '#a84a35';
      ctx.fillRect(30, -50, 50, 50);

      // Main Roof
      ctx.fillStyle = '#3d405b';
      ctx.beginPath();
      ctx.moveTo(-80, -75);
      ctx.lineTo(-20, -115);
      ctx.lineTo(40, -75);
      ctx.closePath();
      ctx.fill();

      // Garage roof
      ctx.beginPath();
      ctx.moveTo(25, -50);
      ctx.lineTo(55, -70);
      ctx.lineTo(85, -50);
      ctx.closePath();
      ctx.fill();

      // Front Door (Teal)
      ctx.fillStyle = '#81b29a';
      ctx.fillRect(-15, -36, 26, 36);
      ctx.fillStyle = '#ffd166'; // brass handle
      ctx.fillRect(5, -18, 2, 4);

      // Garage Door
      ctx.fillStyle = '#f2cc8f';
      ctx.fillRect(36, -38, 38, 38);
      ctx.fillStyle = '#d4a373';
      for (let gy = -32; gy < 0; gy += 8) {
        ctx.fillRect(36, gy, 38, 2);
      }

      // Windows (glowing inside lights)
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = '#3d405b';
      ctx.lineWidth = 2.5;
      // Window left downstairs
      ctx.fillRect(-52, -45, 20, 20);
      ctx.strokeRect(-52, -45, 20, 20);
      // Window upstairs dormer
      ctx.fillRect(-22, -80, 16, 16);
      ctx.strokeRect(-22, -80, 16, 16);
    }

    ctx.restore();
  },

  // Draw RV Trailer
  drawRV(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // RV body (Retro rounded camper look)
    ctx.fillStyle = '#eae2b7';
    ctx.beginPath();
    ctx.moveTo(-50, -10);
    ctx.lineTo(-50, -45);
    ctx.quadraticCurveTo(-50, -55, -35, -55);
    ctx.lineTo(40, -55);
    ctx.quadraticCurveTo(55, -55, 55, -35);
    ctx.lineTo(55, -10);
    ctx.closePath();
    ctx.fill();

    // Bottom stripe (cyan/orange retro striping)
    ctx.fillStyle = '#f77f00';
    ctx.fillRect(-50, -25, 105, 6);
    ctx.fillStyle = '#fcbf49';
    ctx.fillRect(-50, -19, 105, 5);

    // Window
    ctx.fillStyle = '#003049';
    ctx.fillRect(-25, -45, 30, 15);
    // curtains
    ctx.fillStyle = '#eae2b7';
    ctx.fillRect(-25, -45, 6, 15);
    ctx.fillRect(-1, -45, 6, 15);

    // Door
    ctx.fillStyle = '#d62828';
    ctx.fillRect(18, -42, 18, 32);
    ctx.fillStyle = '#fff';
    ctx.fillRect(23, -36, 8, 8); // door window

    // Wheel
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-20, -5, 10, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(-20, -5, 5, 0, Math.PI*2);
    ctx.fill();

    // Hitch triangle
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-50, -8);
    ctx.lineTo(-65, -8);
    ctx.lineTo(-65, -2);
    ctx.stroke();

    ctx.restore();
  },

  // Draw Mount Fuji (majestic towering background silhouette in Stage 10)
  drawFuji(ctx, x, y, width = 720, height = 370) {
    ctx.save();
    ctx.translate(x, y);

    const halfW = width / 2;
    const topW = width * 0.07; // Dynamic narrow top crater rim (~7%)

    // 1. Draw the Majestic Rising Sun (red-orange sun of Japan) behind Mt. Fuji
    const sunRadius = height * 0.45;
    const sunGrad = ctx.createRadialGradient(
      0, -height * 0.5, sunRadius * 0.1,
      0, -height * 0.5, sunRadius
    );
    sunGrad.addColorStop(0, '#ff4b4b'); // Intense crimson center
    sunGrad.addColorStop(0.3, '#ff6b3d'); // Warm orange mid-glow
    sunGrad.addColorStop(1, 'rgba(254, 180, 123, 0)'); // Fades into sky
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(0, -height * 0.5, sunRadius, 0, Math.PI * 2);
    ctx.fill();

    // Soft sun rays / halo ring
    ctx.strokeStyle = 'rgba(255, 230, 200, 0.15)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -height * 0.5, sunRadius * 1.15, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Mountain Body (concave sweeping curves)
    const mountainGrad = ctx.createLinearGradient(0, -height, 0, 0);
    mountainGrad.addColorStop(0, '#111827'); // Volcanic dark charcoal-blue peak
    mountainGrad.addColorStop(0.3, '#1e293b'); // Deep slate blue
    mountainGrad.addColorStop(0.65, '#3b5284'); // Majestic indigo blue
    mountainGrad.addColorStop(1, '#637db6'); // Dusty twilight blue base

    ctx.fillStyle = mountainGrad;
    ctx.beginPath();
    ctx.moveTo(-halfW, 0);
    // Exponential sweeping curve: starts flat at base, sweeps up near the top
    ctx.bezierCurveTo(-halfW * 0.45, 0, -topW * 1.8, -height * 0.85, -topW, -height);
    ctx.lineTo(topW, -height);
    ctx.bezierCurveTo(topW * 1.8, -height * 0.85, halfW * 0.45, 0, halfW, 0);
    ctx.closePath();
    ctx.fill();

    // 3. Snow Cap (White shroud draping elegantly down the peak)
    const snowGrad = ctx.createLinearGradient(0, -height, 0, -height * 0.5);
    snowGrad.addColorStop(0, '#ffffff');
    snowGrad.addColorStop(0.4, '#fafcff');
    snowGrad.addColorStop(0.7, '#d5e1f2'); // Soft sky-blue shadow
    snowGrad.addColorStop(1, 'rgba(213, 225, 242, 0)'); // Fades into mountain base

    ctx.fillStyle = snowGrad;
    ctx.beginPath();
    
    // Starting point on the left slope of the snow cap
    const leftSlopeX = -topW * 1.75;
    const leftSlopeY = -height * 0.65;
    ctx.moveTo(leftSlopeX, leftSlopeY);
    ctx.bezierCurveTo(-topW * 1.3, -height * 0.85, -topW, -height, -topW, -height);
    ctx.lineTo(topW, -height);
    ctx.bezierCurveTo(topW, -height, topW * 1.3, -height * 0.85, topW * 1.75, leftSlopeY);
    
    // Jagged, elegant snow fingers/ridges wrapping around valleys
    ctx.lineTo(topW * 1.45, -height * 0.72);
    ctx.lineTo(topW * 1.05, -height * 0.62);
    ctx.lineTo(topW * 0.75, -height * 0.76);
    ctx.lineTo(topW * 0.35, -height * 0.60);
    ctx.lineTo(0, -height * 0.74);
    ctx.lineTo(-topW * 0.35, -height * 0.60);
    ctx.lineTo(-topW * 0.75, -height * 0.76);
    ctx.lineTo(-topW * 1.05, -height * 0.62);
    ctx.lineTo(-topW * 1.45, -height * 0.72);
    
    ctx.closePath();
    ctx.fill();

    // 4. Detailed Crevices & Shadows in the Snow (gives it 3D definition)
    ctx.strokeStyle = 'rgba(150, 175, 210, 0.5)'; // Soft blue shadow lines
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    
    const drawCrevice = (sx, sy, ex, ey) => {
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    };
    
    // Snow crevices mapping
    drawCrevice(-topW * 0.2, -height * 0.93, -topW * 0.3, -height * 0.78);
    drawCrevice(topW * 0.15, -height * 0.95, topW * 0.25, -height * 0.76);
    drawCrevice(-topW * 0.6, -height * 0.90, -topW * 0.85, -height * 0.72);
    drawCrevice(topW * 0.55, -height * 0.91, topW * 0.75, -height * 0.74);
    drawCrevice(-topW * 1.1, -height * 0.84, -topW * 1.3, -height * 0.68);
    drawCrevice(topW * 1.1, -height * 0.84, topW * 1.3, -height * 0.68);

    // 5. Layered Mist / Clouds wrapping the base (enhances height & mood)
    const drawMistCloud = (cx, cy, cw, ch) => {
      const mistGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cw);
      mistGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
      mistGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
      mistGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = mistGrad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    drawMistCloud(-halfW * 0.5, -height * 0.32, width * 0.3, height * 0.08);
    drawMistCloud(halfW * 0.5, -height * 0.35, width * 0.32, height * 0.09);
    drawMistCloud(0, -height * 0.28, width * 0.45, height * 0.11);
    drawMistCloud(-halfW * 0.8, -height * 0.2, width * 0.25, height * 0.06);
    drawMistCloud(halfW * 0.8, -height * 0.18, width * 0.25, height * 0.06);

    ctx.restore();
  },

  // Draw Cherry Blossom Branches in ending level
  drawCherryBranch(ctx, bx, by, time) {
    ctx.save();
    ctx.translate(bx, by);

    // Branch structure
    ctx.strokeStyle = '#2b1d1d';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(80, 20, 160, -10);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(60, 15);
    ctx.quadraticCurveTo(100, 40, 120, 30);
    ctx.moveTo(110, 5);
    ctx.quadraticCurveTo(130, -20, 150, -15);
    ctx.stroke();

    // Cherry blossoms petals (pink fluff)
    ctx.fillStyle = '#ffccd5';
    const drawBlossom = (px, py, radius) => {
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#ffb3c1';
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.6, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#ffccd5';
    };

    // Cluster points
    const clusters = [
      [20, 5, 8], [40, 12, 10], [60, 15, 9], [80, 22, 12],
      [100, 28, 10], [120, 30, 8], [110, 5, 9], [130, -12, 11],
      [145, -15, 8], [130, 10, 10], [150, -5, 12], [160, -10, 7]
    ];
    clusters.forEach(c => {
      // Gentle breeze sway
      const sway = Math.sin(time * 0.05 + c[0]) * 2;
      drawBlossom(c[0] + sway, c[1] + sway, c[2]);
    });

    ctx.restore();
  },

  // Draw SUV and Teardrop Trailer with the family inside (Level 9) 🚐💨
  drawSUVAndTeardrop(ctx, x, y, frame, dir) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);

    const wheelRot = -frame * 0.16; // rotate wheels based on movement
    const bounce = Math.sin(frame * 0.12) * 0.8; // engine vibration bounce

    // --- TEARDROP TRAILER (Silver with Yellow accent stripe) ---
    ctx.save();
    ctx.translate(-75, bounce);

    // Body
    ctx.fillStyle = '#e5e5e5'; // Silver
    ctx.beginPath();
    ctx.moveTo(35, -12);
    ctx.quadraticCurveTo(35, -42, 5, -42);
    ctx.quadraticCurveTo(-32, -42, -32, -22);
    ctx.quadraticCurveTo(-32, -12, -22, -12);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#8e8e93';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Yellow Accent Stripe
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(33, -20);
    ctx.quadraticCurveTo(28, -28, 5, -28);
    ctx.quadraticCurveTo(-20, -28, -30, -22);
    ctx.quadraticCurveTo(-30, -18, -20, -22);
    ctx.quadraticCurveTo(5, -22, 28, -14);
    ctx.closePath();
    ctx.fill();

    // Window (Round)
    ctx.fillStyle = 'rgba(173, 216, 230, 0.6)';
    ctx.strokeStyle = '#8e8e93';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(5, -28, 7.5, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Glass sheen
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.arc(5, -28, 7.5, Math.PI, Math.PI*1.5);
    ctx.closePath();
    ctx.fill();

    // Wheel
    this.drawCarWheel(ctx, 0, -12, 12, wheelRot);

    ctx.restore();

    // --- HITCH BAR ---
    ctx.strokeStyle = '#555566';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-40, -12 + bounce);
    ctx.lineTo(-2, -12);
    ctx.stroke();

    // --- WHITE SUV ---
    ctx.save();
    ctx.translate(25, bounce);

    // Shadow under wheels
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(-15, -4, 85, 4);

    // --- HEAVY WINDOW BACKGROUND & CUSTOM FAMILY HEADS ---
    // Ellen (Driver)
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(43, -27, 6.5, 0, Math.PI*2);
    ctx.fill();
    // Ellen Hair (Dark brown)
    ctx.fillStyle = '#2b1d1d';
    ctx.beginPath();
    ctx.arc(43, -28, 7, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(36.5, -28, 3.5, 5); // back hair
    // Eye & Smile
    ctx.fillStyle = '#222';
    ctx.fillRect(46, -28, 1.5, 1.5);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(45, -25, 1.5, 0, Math.PI);
    ctx.stroke();

    // Husband (Passenger next to her)
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(33, -26, 6.2, 0, Math.PI*2);
    ctx.fill();
    // Hair
    ctx.fillStyle = '#4a3728';
    ctx.beginPath();
    ctx.arc(33, -27, 6.5, Math.PI, 0);
    ctx.fill();
    // Eye & Smile
    ctx.fillStyle = '#222';
    ctx.fillRect(36, -27, 1.2, 1.2);
    ctx.beginPath();
    ctx.arc(35, -24, 1.2, 0, Math.PI);
    ctx.stroke();

    // Preston (Boy in Blue Shirt)
    ctx.fillStyle = '#0077b6'; // blue shirt
    ctx.fillRect(17, -21, 10, 5);
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(22, -24, 5.2, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#4a3728';
    ctx.beginPath();
    ctx.arc(22, -25, 5.5, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.fillRect(24, -25, 1, 1);

    // Blaire (Girl with Ponytail/Bow)
    ctx.fillStyle = '#ff7096'; // pink dress
    ctx.fillRect(8, -19, 8, 4);
    ctx.fillStyle = '#ffd1ac';
    ctx.beginPath();
    ctx.arc(12, -22, 4.5, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#4a3728';
    ctx.beginPath();
    ctx.arc(12, -23, 4.8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#ff477e'; // ponytail bow
    ctx.beginPath();
    ctx.arc(8, -25, 1.5, 0, Math.PI*2);
    ctx.fill();

    // Mochi (White Shih Tzu looking out the rear window)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -21, 4.8, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#e5dec9'; // tan ear
    ctx.beginPath();
    ctx.arc(-4, -21, 2, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#222'; // eye & nose
    ctx.beginPath();
    ctx.arc(2, -21, 1, 0, Math.PI*2);
    ctx.arc(0, -19, 0.8, 0, Math.PI*2);
    ctx.fill();

    // --- SUV BODY SHELL ---
    ctx.fillStyle = '#ffffff'; // White SUV
    ctx.strokeStyle = '#8e8e93';
    ctx.lineWidth = 1.8;
    
    ctx.beginPath();
    ctx.moveTo(-10, -14);
    ctx.lineTo(-10, -32);
    ctx.quadraticCurveTo(-10, -36, -6, -36);
    ctx.lineTo(48, -36);
    ctx.quadraticCurveTo(58, -36, 61, -26);
    ctx.lineTo(72, -22);
    ctx.lineTo(72, -14);
    ctx.lineTo(60, -14);
    ctx.lineTo(54, -14);
    ctx.arc(43, -12, 16, 0, Math.PI, true); // front wheel well
    ctx.lineTo(32, -14);
    ctx.lineTo(14, -14);
    ctx.arc(3, -12, 16, 0, Math.PI, true); // rear wheel well
    ctx.lineTo(-10, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bumper trims
    ctx.fillStyle = '#555566';
    ctx.fillRect(-10, -14, 4, 6);
    ctx.fillRect(68, -14, 4, 6);
    
    // Windows Glass overlays with B-pillar and C-pillar
    ctx.fillStyle = 'rgba(150, 210, 240, 0.45)';
    ctx.strokeStyle = '#8e8e93';
    ctx.lineWidth = 1.2;

    // Windshield side window
    ctx.beginPath();
    ctx.moveTo(34, -33);
    ctx.lineTo(49, -33);
    ctx.lineTo(56, -24);
    ctx.lineTo(34, -24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Rear side window
    ctx.beginPath();
    ctx.moveTo(14, -33);
    ctx.lineTo(30, -33);
    ctx.lineTo(30, -24);
    ctx.lineTo(14, -24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cargo window
    ctx.beginPath();
    ctx.moveTo(-5, -33);
    ctx.lineTo(10, -33);
    ctx.lineTo(10, -24);
    ctx.lineTo(-5, -24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Door handles
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(35, -22, 5, 2);
    ctx.fillRect(15, -22, 5, 2);

    // Headlight Beam projection
    const headlightGrad = ctx.createLinearGradient(72, -18, 170, -18);
    headlightGrad.addColorStop(0, 'rgba(255, 255, 160, 0.8)');
    headlightGrad.addColorStop(0.3, 'rgba(255, 255, 160, 0.35)');
    headlightGrad.addColorStop(1, 'rgba(255, 255, 160, 0)');
    ctx.fillStyle = headlightGrad;
    ctx.beginPath();
    ctx.moveTo(71, -20);
    ctx.lineTo(165, -48);
    ctx.lineTo(165, 4);
    ctx.lineTo(71, -12);
    ctx.closePath();
    ctx.fill();

    // SUV Wheels
    this.drawCarWheel(ctx, 43, -12, 11, wheelRot);
    this.drawCarWheel(ctx, 3, -12, 11, wheelRot);

    ctx.restore();
  },

  // Helper to draw a rotating car wheel
  drawCarWheel(ctx, cx, cy, r, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    // Tire
    ctx.fillStyle = '#1e1e24';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fill();

    // Rim
    ctx.fillStyle = '#dcdcdc';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.65, 0, Math.PI*2);
    ctx.fill();

    // Hubcap
    ctx.fillStyle = '#8e8e93';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.25, 0, Math.PI*2);
    ctx.fill();

    // Spokes
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-r*0.6, 0); ctx.lineTo(r*0.6, 0);
    ctx.moveTo(0, -r*0.6); ctx.lineTo(0, r*0.6);
    ctx.stroke();

    ctx.restore();
  },

  // Draw Polaroid Memory Card with photo or procedural sketch
  drawPolaroid(ctx, x, y, level, alpha, time) {
    if (alpha <= 0.01) return;

    // Cycle through multiple photos for a memory (e.g. camping) every ~2.6s.
    const imgs = level.imgElements || [];
    const curIdx = imgs.length > 1 ? Math.floor(time / 2600) % imgs.length : 0;

    if (this.checkOptimize()) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      const floatY = Math.sin(time * 0.002 + level.id) * 6;
      const rotateAngle = Math.sin(time * 0.0012 + level.id) * 0.04 - 0.02;
      ctx.translate(0, floatY);
      ctx.rotate(rotateAngle);
      this._drawPolaroidDirect(ctx, 0, 0, level, 1, 0, curIdx);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    // Subtle float animation (oscillation)
    const floatY = Math.sin(time * 0.002 + level.id) * 6;
    const rotateAngle = Math.sin(time * 0.0012 + level.id) * 0.04 - 0.02; // osc between -3 and +1 degs
    ctx.translate(0, floatY);
    ctx.rotate(rotateAngle);

    const img = imgs[curIdx];
    const hasImage = !!(img && img.complete && img.naturalWidth > 0);
    // Include the photo index so each cycled photo gets its own cached frame.
    const key = `polaroid_${level.id}_${curIdx}_${hasImage}`;

    const cachedCanvas = this.getCached(
      key,
      (offscreenCtx) => {
        this._drawPolaroidDirect(offscreenCtx, 0, 0, level, 1, 0, curIdx);
      },
      160,
      185,
      80,
      90
    );

    ctx.drawImage(cachedCanvas, -80, -90);
    ctx.restore();
  },

  // Draw an image scaled to COVER the target rect (center-crop, no stretching).
  _drawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return;
    const ir = iw / ih, dr = dw / dh;
    let sx, sy, sw, sh;
    if (ir > dr) { sh = ih; sw = ih * dr; sx = (iw - sw) / 2; sy = 0; }
    else { sw = iw; sh = iw / dr; sx = 0; sy = (ih - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  },

  _drawPolaroidDirect(ctx, x, y, level, alpha, time, imgIdx = 0) {
    if (alpha <= 0.01) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);

    const cardW = 120;
    const cardH = 145;
    const photoW = 104;
    const photoH = 100;

    // --- POLAROID FRAME (White cardboard) ---
    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 6;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-cardW / 2, -cardH / 2, cardW, cardH);

    // Disable shadow for inner drawing
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // --- PHOTO AREA ---
    const px = -photoW / 2;
    const py = -cardH / 2 + 8; // top margin 8px

    // Check if the user has loaded a valid image (the current one in the cycle)
    const img = (level.imgElements || [])[imgIdx] || (level.imgElements || [])[0];
    if (img && img.complete && img.naturalWidth > 0) {
      // Draw actual photo, center-cropped to fill the frame (no stretching)
      this._drawImageCover(ctx, img, px, py, photoW, photoH);
    } else {
      // Draw procedural sketch placeholder! 🎨
      // Soft pastel colored background for the photo frame
      const pastelColors = [
        '#ffe5ec', '#ffccd5', '#e8f0fe', '#e2ece9', '#f0f3f4',
        '#fdf2e9', '#eae2b7', '#d8f3dc', '#ffe5ec', '#ffecd2'
      ];
      ctx.fillStyle = pastelColors[(level.id - 1) % pastelColors.length];
      ctx.fillRect(px, py, photoW, photoH);

      // Draw border inside photo frame
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, photoW, photoH);

      // Draw Sketch
      ctx.save();
      ctx.translate(0, py + photoH / 2); // Center sketch inside photo area
      this.drawPlaceholderSketch(ctx, level.id);
      ctx.restore();
    }

    // --- PHOTO GLOSS REFLECTION ---
    // A diagonal semi-transparent white sheen across the picture area
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + photoW * 0.7, py);
    ctx.lineTo(px, py + photoH * 0.7);
    ctx.closePath();
    ctx.fill();

    // --- CAPTION TEXT ---
    ctx.fillStyle = '#2b1d1d';
    // Handwritten caption look
    ctx.font = '600 10.5px "Outfit", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(level.name, 0, cardH / 2 - 20);
    
    ctx.fillStyle = 'rgba(43, 29, 29, 0.6)';
    ctx.font = '500 8.5px "Outfit", sans-serif';
    ctx.fillText(level.year, 0, cardH / 2 - 8);

    ctx.restore();
  },

  // Helper to draw cute minimal stylized vectors for placeholders
  drawPlaceholderSketch(ctx, id) {
    ctx.save();
    ctx.strokeStyle = '#555566';
    ctx.fillStyle = '#ff7096';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch(id) {
      case 1: // Graduation: Cap & Scroll
        // Cap diamond
        ctx.fillStyle = '#3d405b';
        ctx.beginPath();
        ctx.moveTo(0, -15); ctx.lineTo(22, -6); ctx.lineTo(0, 3); ctx.lineTo(-22, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Scroll roll
        ctx.fillStyle = '#fff';
        ctx.fillRect(-12, 6, 24, 6);
        ctx.strokeRect(-12, 6, 24, 6);
        ctx.fillStyle = '#e76f51'; // ribbon
        ctx.fillRect(-2, 6, 4, 6);
        break;

      case 2: // Mochi: Fluffy Shih Tzu head
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI*2); // skull
        ctx.fill();
        ctx.stroke();
        // ears
        ctx.fillStyle = '#e5dec9';
        ctx.beginPath();
        ctx.ellipse(-10, 0, 4, 7, 0.2, 0, Math.PI*2);
        ctx.ellipse(10, 0, 4, 7, -0.2, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        // eyes
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(-4, -2, 1.8, 0, Math.PI*2);
        ctx.arc(4, -2, 1.8, 0, Math.PI*2);
        ctx.fill();
        // nose
        ctx.beginPath();
        ctx.arc(0, 2, 1.5, 0, Math.PI*2);
        ctx.fill();
        break;

      case 3: // Engagement: Proposal ring
        // Ring circle
        ctx.strokeStyle = '#f4a261'; // gold
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 5, 10, 0, Math.PI*2);
        ctx.stroke();
        // Diamond
        ctx.fillStyle = '#a8dadc';
        ctx.strokeStyle = '#457b9d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(8, -5);
        ctx.lineTo(0, -1);
        ctx.lineTo(-8, -5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 4: // Wedding: Interlocked Hearts
        const drawMiniHeart = (hx, hy, hscale, color) => {
          ctx.save();
          ctx.translate(hx, hy);
          ctx.scale(hscale, hscale);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(-6, -6, -12, 0, 0, 10);
          ctx.bezierCurveTo(12, 0, 6, -6, 0, 0);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        };
        drawMiniHeart(-8, 2, 0.9, '#ff7096');
        drawMiniHeart(6, -4, 0.8, '#ff477e');
        break;

      case 5: // First Home: Key
        // key head
        ctx.strokeStyle = '#cca43b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-8, 0, 7, 0, Math.PI*2);
        ctx.stroke();
        // key shaft
        ctx.beginPath();
        ctx.moveTo(-1, 0);
        ctx.lineTo(18, 0);
        // teeth
        ctx.moveTo(12, 0); ctx.lineTo(12, 5);
        ctx.moveTo(16, 0); ctx.lineTo(16, 5);
        ctx.stroke();
        break;

      case 6: // Preston: Baby Pacifier
        ctx.strokeStyle = '#4ea8de';
        // Ring
        ctx.beginPath();
        ctx.arc(0, 8, 7, 0, Math.PI*2);
        ctx.stroke();
        // Shield
        ctx.fillStyle = '#0077b6';
        ctx.beginPath();
        ctx.ellipse(0, 0, 15, 5, 0, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        // Nipple
        ctx.fillStyle = '#ffd1ac';
        ctx.beginPath();
        ctx.arc(0, -9, 5.5, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        break;

      case 7: // Second House: Cozy House
        // body
        ctx.fillStyle = '#f4f1de';
        ctx.fillRect(-15, -4, 30, 20);
        ctx.strokeRect(-15, -4, 30, 20);
        // roof
        ctx.fillStyle = '#3d405b';
        ctx.beginPath();
        ctx.moveTo(-20, -4); ctx.lineTo(0, -20); ctx.lineTo(20, -4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // door
        ctx.fillStyle = '#e07a5f';
        ctx.fillRect(-4, 6, 8, 10);
        ctx.strokeRect(-4, 6, 8, 10);
        break;

      case 8: // Blaire: Toy blocks
        const drawMiniBlock = (bx, by, val, color) => {
          ctx.fillStyle = color;
          ctx.fillRect(bx, by, 12, 12);
          ctx.strokeRect(bx, by, 12, 12);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(val, bx+6, by+9);
        };
        drawMiniBlock(-12, -4, 'B', '#ff7096');
        drawMiniBlock(2, 4, 'A', '#ffd166');
        break;

      case 9: // Camping: Campfire & Pine tree
        // tree
        ctx.fillStyle = '#4f7a30';
        ctx.beginPath();
        ctx.moveTo(-12, 10); ctx.lineTo(-4, -14); ctx.lineTo(4, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // campfire
        ctx.fillStyle = '#ff5400';
        ctx.beginPath();
        ctx.moveTo(4, 12);
        ctx.lineTo(12, -2);
        ctx.lineTo(20, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 10: // Mt Fuji: Blossom petal
        ctx.fillStyle = '#ffccd5';
        for (let i = 0; i < 5; i++) {
          ctx.save();
          ctx.rotate((i * Math.PI * 2) / 5);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-7, -12, 0, -18);
          ctx.quadraticCurveTo(7, -12, 0, 0);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
        // center
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
        break;

      case 11: // Started Dating: Two hearts
        [[-6, -6, 16, '#ff477e'], [7, 1, 13, '#ff7096']].forEach(p => {
          ctx.fillStyle = p[3];
          ctx.beginPath();
          ctx.arc(p[0] - p[2] / 2, p[1], p[2] / 2, Math.PI, 0);
          ctx.arc(p[0] + p[2] / 2, p[1], p[2] / 2, Math.PI, 0);
          ctx.lineTo(p[0], p[1] + p[2]);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
        break;

      default:
        break;
    }
    ctx.restore();
  },

  // ============================================================
  // COMBAT SPRITES (sword/gun pickups, enemies, trampoline, FX)
  // ============================================================

  // Floating pickup. kind: 'racket' | 'balls'
  drawWeaponPickup(ctx, x, y, kind, frame) {
    ctx.save();
    const bob = Math.sin(frame * 0.08) * 4;
    ctx.translate(x, y + bob);

    // Glow halo
    const glow = ctx.createRadialGradient(0, -12, 2, 0, -12, 28);
    glow.addColorStop(0, 'rgba(214, 246, 90, 0.55)');
    glow.addColorStop(1, 'rgba(214, 246, 90, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -12, 28, 0, Math.PI * 2);
    ctx.fill();

    if (kind === 'racket') {
      ctx.save();
      ctx.rotate(-0.35);
      // Handle
      ctx.fillStyle = '#6d4c2f';
      ctx.fillRect(-2.5, -6, 5, 22);
      ctx.fillStyle = '#5a3d25';
      ctx.fillRect(-2.5, 12, 5, 4); // butt cap
      // Head (oval frame)
      ctx.strokeStyle = '#e63946';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, -20, 11, 15, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Throat
      ctx.fillStyle = '#e63946';
      ctx.beginPath();
      ctx.moveTo(-4, -8); ctx.lineTo(4, -8); ctx.lineTo(2.5, -4); ctx.lineTo(-2.5, -4); ctx.closePath();
      ctx.fill();
      // Strings
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.8;
      for (let i = -8; i <= 8; i += 4) {
        ctx.beginPath(); ctx.moveTo(i, -32); ctx.lineTo(i, -8); ctx.stroke();
      }
      for (let j = -33; j <= -8; j += 4) {
        ctx.beginPath(); ctx.moveTo(-10, j); ctx.lineTo(10, j); ctx.stroke();
      }
      ctx.restore();
    } else {
      // A few tennis balls
      const ball = (bx, by) => {
        ctx.fillStyle = '#d6f65a';
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx - 4, by - 4, 8, 0.2, 1.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(bx + 4, by + 4, 8, Math.PI + 0.2, Math.PI + 1.4);
        ctx.stroke();
      };
      ball(-6, -10);
      ball(7, -14);
      ball(1, -2);
    }
    ctx.restore();
  },

  // Bounce pad. y = top surface. squash 0..1 compresses the band.
  drawTrampoline(ctx, x, y, w, squash) {
    ctx.save();
    ctx.translate(x, y);
    const half = w / 2;
    const dip = squash * 9;

    // Legs
    ctx.strokeStyle = '#3a3f55';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-half + 6, 0); ctx.lineTo(-half + 2, 22);
    ctx.moveTo(half - 6, 0); ctx.lineTo(half - 2, 22);
    ctx.stroke();

    // Frame ring
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.ellipse(0, 0, half, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bouncy mat (dips when squashed)
    ctx.fillStyle = '#222633';
    ctx.beginPath();
    ctx.ellipse(0, dip, half - 6, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spring highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, dip - 1, half - 9, 4, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  // Cute monster enemies. kind: 'slime_green'|'slime_purple'|'slime_teal' (ground)
  // and 'cloud'|'bat' (flying). y = vertical CENTER. hitFlash > 0 tints white on hit.
  // tier 2 = tougher 2-hit monster: drawn bigger, with hp pips above it.
  drawEnemy(ctx, x, y, kind, frame, dir, hitFlash, tier, hp, maxHp) {
    ctx.save();
    ctx.translate(x, y);
    // Tougher monsters are physically bigger so they read as stronger
    if (tier >= 2) ctx.scale(1.4, 1.4);
    if (dir < 0) ctx.scale(-1, 1);
    const wob = Math.sin(frame * 0.18) * 2;

    const flash = hitFlash > 0;

    if (kind && kind.indexOf('slime') === 0) {
      // Wobbly grumpy jelly blob
      const slimeColors = {
        slime_green:  { body: '#5fbf57', dark: '#3f9a3a' },
        slime_purple: { body: '#a85cd0', dark: '#7e3fa6' },
        slime_teal:   { body: '#1fb6a6', dark: '#138a7e' }
      };
      const c = slimeColors[kind] || slimeColors.slime_green;
      // squash/stretch wobble
      const sq = flash ? 0 : Math.sin(frame * 0.16) * 0.12;
      const w = 17 * (1 + sq);
      const h = 16 * (1 - sq);
      // body: rounded dome with a flat, slightly dripping bottom
      ctx.fillStyle = flash ? '#fff' : c.body;
      ctx.beginPath();
      ctx.moveTo(-w, 13);
      ctx.quadraticCurveTo(-w, -h, 0, -h);
      ctx.quadraticCurveTo(w, -h, w, 13);
      // wavy bottom drips
      ctx.quadraticCurveTo(w * 0.6, 17, w * 0.35, 13);
      ctx.quadraticCurveTo(0, 18, -w * 0.35, 13);
      ctx.quadraticCurveTo(-w * 0.6, 17, -w, 13);
      ctx.closePath();
      ctx.fill();
      if (!flash) {
        // darker base shadow
        ctx.fillStyle = c.dark;
        ctx.beginPath();
        ctx.ellipse(0, 12, w * 0.7, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        // glossy highlight
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        ctx.beginPath();
        ctx.ellipse(-6, -4, 4, 6, -0.3, 0, Math.PI * 2);
        ctx.fill();
        // eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-5, -2, 4.2, 0, Math.PI * 2);
        ctx.arc(5, -2, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(-4, -1, 1.9, 0, Math.PI * 2);
        ctx.arc(6, -1, 1.9, 0, Math.PI * 2);
        ctx.fill();
        // grumpy brows
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-9, -7); ctx.lineTo(-2, -5);
        ctx.moveTo(9, -7); ctx.lineTo(2, -5);
        ctx.stroke();
        // little frown
        ctx.beginPath();
        ctx.arc(0, 9, 3.2, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    } else if (kind === 'bat') {
      // Little flappy bat
      ctx.translate(0, wob);
      const flap = Math.sin(frame * 0.4) * 7;
      const body = flash ? '#fff' : '#5b4a73';
      // wings
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(-16, -flap, -23, 3);
      ctx.quadraticCurveTo(-15, 3, -13, 8);
      ctx.quadraticCurveTo(-11, 3, -6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.quadraticCurveTo(16, -flap, 23, 3);
      ctx.quadraticCurveTo(15, 3, 13, 8);
      ctx.quadraticCurveTo(11, 3, 6, 5);
      ctx.closePath();
      ctx.fill();
      // body
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      // ears
      ctx.beginPath();
      ctx.moveTo(-5, -6); ctx.lineTo(-7, -13); ctx.lineTo(-1, -7); ctx.closePath();
      ctx.moveTo(5, -6); ctx.lineTo(7, -13); ctx.lineTo(1, -7); ctx.closePath();
      ctx.fill();
      if (!flash) {
        // eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-3, -1, 2.6, 0, Math.PI * 2);
        ctx.arc(3, -1, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(-3, -1, 1.2, 0, Math.PI * 2);
        ctx.arc(3, -1, 1.2, 0, Math.PI * 2);
        ctx.fill();
        // fangs
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(-2, 5); ctx.lineTo(-0.5, 8); ctx.lineTo(0.5, 5); ctx.closePath();
        ctx.moveTo(2, 5); ctx.lineTo(0.5, 8); ctx.lineTo(-0.5, 5); ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'cloud') {
      // Grumpy rain cloud (flying)
      ctx.translate(0, wob);
      ctx.fillStyle = flash ? '#fff' : '#6c7a89';
      ctx.beginPath();
      ctx.arc(-10, 0, 10, 0, Math.PI * 2);
      ctx.arc(2, -4, 13, 0, Math.PI * 2);
      ctx.arc(14, 2, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-10, 0, 24, 9);
      if (!flash) {
        // rain
        ctx.strokeStyle = '#4ea8de';
        ctx.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
          const ry = 12 + ((frame * 0.6 + i * 6) % 10);
          ctx.beginPath();
          ctx.moveTo(i * 8, 9 + ry - 12); ctx.lineTo(i * 8, ry);
          ctx.stroke();
        }
        // grumpy eyes
        ctx.fillStyle = '#1c2530';
        ctx.beginPath();
        ctx.arc(-2, -4, 2, 0, Math.PI * 2);
        ctx.arc(8, -3, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1c2530';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-6, -8); ctx.lineTo(0, -6);
        ctx.moveTo(12, -7); ctx.lineTo(5, -6);
        ctx.stroke();
      }
    }
    ctx.restore();

    // HP pips above tougher (2-hit) monsters so it's clear they take 2 hits
    if (maxHp > 1) {
      const topY = y - (tier >= 2 ? 34 : 24);
      const gap = 8;
      const startX = x - ((maxHp - 1) * gap) / 2;
      for (let i = 0; i < maxHp; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * gap, topY, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = i < hp ? '#ff4d6d' : 'rgba(0,0,0,0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  },

  // Quick "poof" defeat puff
  drawPoof(ctx, x, y, progress) {
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 1 - progress;
    const r = 6 + progress * 18;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 5 - progress * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  // Sword slash arc. progress 0..1 sweeps the blade.
  drawSlash(ctx, x, y, dir, progress) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.globalAlpha = 1 - progress * 0.6;
    const sweep = -0.9 + progress * 1.8; // rotate top->down
    ctx.rotate(sweep);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 46, -0.5, 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180,225,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 52, -0.45, 0.45);
    ctx.stroke();
    ctx.restore();
  },

  // Served tennis ball (player projectile). spin rotates the seam.
  drawBullet(ctx, x, y, dir, spin) {
    ctx.save();
    ctx.translate(x, y);
    // motion trail
    ctx.fillStyle = 'rgba(214,246,90,0.30)';
    ctx.beginPath();
    ctx.ellipse(-dir * 9, 0, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // ball
    ctx.rotate(spin || 0);
    ctx.fillStyle = '#d6f65a';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    // seam curves
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(-3.5, -3.5, 7, 0.2, 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.5, 3.5, 7, Math.PI + 0.2, Math.PI + 1.5);
    ctx.stroke();
    ctx.restore();
  },

  // Tennis racket drawn in Ellen's hand. anchor (x,y) = her feet position.
  // swing 0..1 animates an overhead swing.
  drawHeldWeapon(ctx, x, y, kind, dir, swing) {
    if (!kind) return;
    ctx.save();
    ctx.translate(x + dir * 12, y - 30);
    ctx.scale(dir, 1);

    // Swing arcs the racket from cocked-back to follow-through
    const ang = swing > 0 ? (-1.0 + swing * 2.0) : -0.35;
    ctx.rotate(ang);
    // Handle
    ctx.fillStyle = '#6d4c2f';
    ctx.fillRect(-2, -3, 4, 12);
    // Head (oval frame)
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -16, 8, 11, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Strings
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.7;
    for (let i = -6; i <= 6; i += 3) {
      ctx.beginPath(); ctx.moveTo(i, -25); ctx.lineTo(i, -7); ctx.stroke();
    }
    for (let j = -25; j <= -7; j += 3) {
      ctx.beginPath(); ctx.moveTo(-7, j); ctx.lineTo(7, j); ctx.stroke();
    }
    ctx.restore();
  },

  // Projectile fired BY an enemy at Ellen. kind tints it to match the foe.
  drawEnemyBullet(ctx, x, y, kind, frame) {
    ctx.save();
    ctx.translate(x, y);
    if (kind === 'cloud') {
      // Rain droplet
      ctx.fillStyle = '#4ea8de';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.bezierCurveTo(5, -1, 5, 6, 0, 6);
      ctx.bezierCurveTo(-5, 6, -5, -1, 0, -7);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(-1.5, 1, 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Bat "screech" orb — dark purple energy
      const r = 5.5 + Math.sin((frame || 0) * 0.4) * 1;
      ctx.fillStyle = 'rgba(91,74,115,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5b4a73';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9a8e0';
      ctx.beginPath();
      ctx.arc(-1.3, -1.3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
};
