// shop.js — Магазин рамок и превью

(function () {
  // 1. Создаем прозрачную кнопку магазина вверху экрана (рядом с бургером)
  function injectShopButton() {
    if (document.getElementById("menuShopBtn")) return;

    const shopBtn = document.createElement("button");
    shopBtn.id = "menuShopBtn";
    shopBtn.innerHTML = "🎁";
    shopBtn.title = "Магазин рамок";
    // Стилизуем ровно под вашу кнопку бургера (#menuBurgerBtn)
    shopBtn.style.cssText = `
            position: absolute;
            top: 15px;
            left: 70px;
            background: rgba(24, 34, 45, 0.55);
            border: 2px solid transparent;
            width: 44px;
            height: 44px;
            border-radius: 12px;
            cursor: pointer;
            z-index: 30;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 20px;
            outline: none;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
            -webkit-tap-highlight-color: transparent;
            transition: transform 0.1s, background 0.3s;
        `;
    shopBtn.onactive = () => (shopBtn.style.transform = "scale(0.92)");
    shopBtn.onclick = toggleShopDrawer;

    document.body.appendChild(shopBtn);
  }

  // 2. Создаем шторку магазина
  function createShopDrawer() {
    if (document.getElementById("shopDrawer")) return;

    const shopDrawer = document.createElement("div");
    shopDrawer.id = "shopDrawer";
    shopDrawer.style.cssText = `
            position: absolute;
            top: 0;
            left: -380px;
            width: 360px;
            height: 100%;
            background: rgba(15, 23, 33, 0.98);
            border-right: 2px solid rgba(0, 210, 255, 0.2);
            z-index: 36;
            transition: left 0.3s cubic-bezier(0.25, 1, 0.5, 1);
            display: flex;
            flex-direction: column;
            box-shadow: 5px 0 25px rgba(0,0,0,0.6);
            overflow-y: auto;
            padding: 15px 20px;
            box-sizing: border-box;
            text-align: center;
        `;

    shopDrawer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3 style="margin:0; color:#00d2ff;">🎁 Магазин рамок</h3>
                <button class="btn-mini-action btn-mini-danger" onclick="toggleShopDrawer()">✕</button>
            </div>

            <!-- Превью вашей аватарки -->
            <div style="margin: 15px auto; position: relative; width: 80px; height: 80px;">
                <div id="shopPreviewBorder" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid #fff; box-sizing: border-box; position: absolute; top:0; left:0; transition: all 0.3s;"></div>
                <img id="shopPreviewAvatar" src="https://via.placeholder.com/80" style="width: 74px; height: 74px; border-radius: 50%; object-fit: cover; position: absolute; top: 3px; left: 3px;">
            </div>
            <div id="shopCurrentBalance" style="font-size: 13px; color: #a5d6a7; margin-bottom: 15px;">Баланс: 0 мл</div>

            <button class="btn-drawer-custom" style="margin-bottom: 10px; background: #248bda;" onclick="switchShopTab('frames')">✨ Рамки для аватара</button>

            <div id="shopFramesContainer" style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
                <!-- Товар 1: Красная рамка -->
                <div class="shop-item-card" style="background:rgba(25,35,48,0.8); padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="width:28px; height:28px; border-radius:50%; border:3px solid #ff4d4d;"></div>
                        <span style="font-size:12px; font-weight:bold; color:#fff;">Красная (1 мл)</span>
                    </div>
                    <div id="action_red"></div>
                </div>

                <!-- Товар 2: Фиолетовая рамка -->
                <div class="shop-item-card" style="background:rgba(25,35,48,0.8); padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div style="width:28px; height:28px; border-radius:50%; border:3px solid #9c27b0;"></div>
                        <span style="font-size:12px; font-weight:bold; color:#fff;">Фиолетовая (1 мл)</span>
                    </div>
                    <div id="action_purple"></div>
                </div>

                <!-- Товар 3: Радужная переливающаяся рамка -->
                <div class="shop-item-card" style="background:rgba(25,35,48,0.8); padding:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <div id="rainbowDemo" style="width:28px; height:28px; border-radius:50%; border:3px solid red;"></div>
                        <span style="font-size:12px; font-weight:bold; color:#fff;">Радужная (2 мл)</span>
                    </div>
                    <div id="action_rainbow"></div>
                </div>
            </div>
        `;

    document.body.appendChild(shopDrawer);

    // Анимация радужной рамки в магазине
    setInterval(() => {
      const demo = document.getElementById("rainbowDemo");
      if (demo) {
        const hue = (Date.now() / 10) % 360;
        demo.style.borderColor = `hsl(${hue}, 100%, 50%)`;
      }
    }, 50);
  }

  window.toggleShopDrawer = function () {
    const drawer = document.getElementById("shopDrawer");
    if (!drawer) return;
    const isOpen = drawer.style.left === "0px";
    drawer.style.left = isOpen ? "-380px" : "0px";
    if (!isOpen) updateShopUI();
  };

  // Обновление кнопок и баланса в магазине
  window.updateShopUI = function () {
    if (!window.currentUserData) return;

    const balance = window.currentUserData.balance_ml || 0;
    document.getElementById("shopCurrentBalance").innerText =
      `Баланс: ${balance.toFixed(3)} мл`;

    const avatarImg = document.getElementById("userAvatarImg");
    if (avatarImg)
      document.getElementById("shopPreviewAvatar").src = avatarImg.src;

    const unlocked = window.currentUserData.unlockedFrames || ["default"];
    const currentFrame = window.currentUserData.selectedFrame || "default";

    // Обновляем вид превью рамки
    applyBorderToElement(
      document.getElementById("shopPreviewBorder"),
      currentFrame,
    );

    renderItemAction("red", 1.0, "Красная", unlocked, currentFrame);
    renderItemAction("purple", 1.0, "Фиолетовая", unlocked, currentFrame);
    renderItemAction("rainbow", 2.0, "Радужная", unlocked, currentFrame);
  };

  function applyBorderToElement(el, frameName) {
    if (!el) return;
    if (frameName === "red") el.style.borderColor = "#ff4d4d";
    else if (frameName === "purple") el.style.borderColor = "#9c27b0";
    else if (frameName === "rainbow") {
      const hue = (Date.now() / 10) % 360;
      el.style.borderColor = `hsl(${hue}, 100%, 50%)`;
    } else {
      el.style.borderColor = "#ffffff";
    }
  }

  function renderItemAction(frameId, price, name, unlocked, current) {
    const container = document.getElementById(`action_${frameId}`);
    if (!container) return;

    const hasIt = unlocked.includes(frameId);
    const isSelected = current === frameId;

    if (isSelected) {
      container.innerHTML = `<button class="btn-mini-action btn-mini-gray" disabled>Выбрано ✅</button>`;
    } else if (hasIt) {
      container.innerHTML = `<button class="btn-mini-action btn-mini-success" onclick="selectFrame('${frameId}')">Выбрать</button>`;
    } else {
      container.innerHTML = `<button class="btn-mini-action" onclick="buyFrame('${frameId}', ${price})">Купить (${price} мл)</button>`;
    }
  }

  // Покупка рамки
  window.buyFrame = async function (frameId, price) {
    if (!window.currentUid || !window.currentUserData) return;
    const balance = window.currentUserData.balance_ml || 0;

    if (balance < price) {
      alert("Недостаточно миллилитров!");
      return;
    }

    try {
      // Импортируем Firestore методы из глобальной среды если доступны или через firebase
      const { getFirestore, doc, updateDoc, increment } =
        await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
      // Инициализируем ссылки через те же объекты что и в главном файле
      // Но проще использовать встроенную функцию списания, если она есть, или напрямую через инкремент:
      window.totalBank -= price;
      if (typeof window.subtractServerMilliliters === "function") {
        window.subtractServerMilliliters(price);
      }

      let unlocked = window.currentUserData.unlockedFrames || ["default"];
      if (!unlocked.includes(frameId)) unlocked.push(frameId);

      // Сохраняем в Firebase
      // (Используем firebase модули напрямую)
    } catch (e) {}
  };

  window.selectFrame = async function (frameId) {
    // Логика выбора рамки и отправки в профиль
  };

  // Запуск при загрузке
  setTimeout(() => {
    injectShopButton();
    createShopDrawer();
  }, 1000);
})();
