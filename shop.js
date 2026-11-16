// shop.js — Финальная версия магазина рамок (живой перелив, раскрывающийся список, скрытие на паузе)

(function() {
    // 1. Создаем стильную кнопку "Магазин" (без смайлика) в главном меню
    function injectShopButton() {
        if (document.getElementById("menuShopBtn")) return;

        const shopBtn = document.createElement("button");
        shopBtn.id = "menuShopBtn";
        shopBtn.innerHTML = "Магазин";
        shopBtn.title = "Магазин рамок";
        // Используем ваши классы и стили кнопок шторки для гармоничного вида
        shopBtn.className = "btn-drawer-custom";
        shopBtn.style.cssText = `
            position: absolute;
            top: 15px;
            left: 70px;
            width: auto;
            min-width: 90px;
            padding: 10px 14px;
            margin: 0;
            z-index: 30;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 14px;
            font-weight: bold;
            background: rgba(20, 70, 110, 0.85);
            border: 1px solid rgba(0, 210, 255, 0.4);
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        `;
        shopBtn.onclick = toggleShopDrawer;
        document.body.appendChild(shopBtn);
    }

    // 2. Создаем шторку магазина с раскрывающимся списком рамок
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
            <div id="shopCurrentBalance" style="font-size: 13px; color: #a5d6a7; margin-bottom: 15px;">Баланс: загрузка...</div>

            <!-- Раскрывающаяся кнопка-аккордеон для рамок -->
            <button class="btn-drawer-custom" style="margin-bottom: 5px; background: #248bda; display:flex; justify-content:space-between; align-items:center;" onclick="toggleShopFramesAccordion()">
                <span>✨ Рамки для аватара</span>
                <span id="accordionArrow">▼</span>
            </button>

            <!-- Выпадающий блок с рамками (скрыт по умолчанию, как ваши шторки) -->
            <div id="shopFramesContainer" class="drawer-section-panel" style="display:none; max-height:280px; margin-top:0; margin-bottom:15px;">
                <div style="width:100%; display:flex; flex-direction:column; gap:6px;">
                    
                    <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:24px; height:24px; border-radius:50%; border:3px solid #fff;"></div>
                            <span style="font-size:11px; font-weight:bold; color:#fff;">Стандартная</span>
                        </div>
                        <div id="action_default"></div>
                    </div>

                    <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:24px; height:24px; border-radius:50%; border:3px solid #ff4d4d;"></div>
                            <span style="font-size:11px; font-weight:bold; color:#fff;">Красная (1 мл)</span>
                        </div>
                        <div id="action_red"></div>
                    </div>

                    <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div style="width:24px; height:24px; border-radius:50%; border:3px solid #9c27b0;"></div>
                            <span style="font-size:11px; font-weight:bold; color:#fff;">Фиолетовая (1 мл)</span>
                        </div>
                        <div id="action_purple"></div>
                    </div>

                    <div style="background:rgba(25,35,48,0.8); padding:8px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <div id="rainbowDemo" style="width:24px; height:24px; border-radius:50%; border:3px solid red;"></div>
                            <span style="font-size:11px; font-weight:bold; color:#fff;">Радужная (2 мл)</span>
                        </div>
                        <div id="action_rainbow"></div>
                    </div>

                </div>
            </div>
        `;

        document.body.appendChild(shopDrawer);
    }

    // Логика раскрытия списка рамок
    window.toggleShopFramesAccordion = function() {
        const container = document.getElementById("shopFramesContainer");
        const arrow = document.getElementById("accordionArrow");
        if (!container) return;
        const isVisible = container.style.display === "flex";
        container.style.display = isVisible ? "none" : "flex";
        if (arrow) arrow.innerText = isVisible ? "▼" : "▲";
    };

    window.toggleShopDrawer = async function() {
        const drawer = document.getElementById("shopDrawer");
        if (!drawer) return;
        const isOpen = drawer.style.left === "0px";
        if (isOpen) {
            drawer.style.left = "-380px";
        } else {
            const profileDrawer = document.getElementById("profileDrawer");
            if (profileDrawer) profileDrawer.classList.remove("open");
            drawer.style.left = "0px";
            await window.updateShopUI();
        }
    };

    // Строгая проверка видимости кнопки (видна ТОЛЬКО в главном меню)
    function checkShopButtonVisibility() {
        const shopBtn = document.getElementById("menuShopBtn");
        const profileDrawer = document.getElementById("profileDrawer");
        const shopDrawer = document.getElementById("shopDrawer");
        
        if (!shopBtn) return;

        const isProfileOpen = profileDrawer && profileDrawer.classList.contains("open");
        const isShopOpen = shopDrawer && shopDrawer.style.left === "0px";
        const isGamePlaying = window.gameStarted === true;
        const isGamePaused = window.isPaused === true;
        const isGameOver = window.gameOver === true;

        // Если идет игра, пауза, поражение или открыта любая шторка — скрываем кнопку магазина
        if (isProfileOpen || isShopOpen || isGamePlaying || isGamePaused || isGameOver) {
            shopBtn.style.display = "none";
        } else {
            shopBtn.style.display = "flex";
        }
    }

    setInterval(checkShopButtonVisibility, 100);

    // Живой цикл обновления переливов радужной рамки везде
    setInterval(() => {
        const hue = (Date.now() / 10) % 360;
        const rainbowColor = `hsl(${hue}, 100%, 50%)`;

        // В магазине (демо и превью)
        const demo = document.getElementById("rainbowDemo");
        if (demo) demo.style.borderColor = rainbowColor;

        const previewBorder = document.getElementById("shopPreviewBorder");
        if (previewBorder && previewBorder.dataset.frame === "rainbow") {
            previewBorder.style.borderColor = rainbowColor;
        }

        // В профиле игрока (если установлена радужная рамка)
        const profileWrap = document.querySelector(".drawer-avatar-wrap");
        if (profileWrap && profileWrap.dataset.frame === "rainbow") {
            profileWrap.style.borderColor = rainbowColor;
        }
    }, 50);

    // Загрузка данных из Firebase
    window.updateShopUI = async function() {
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        if (!activeNick) {
            document.getElementById("shopCurrentBalance").innerText = "Войдите в аккаунт!";
            return;
        }

        try {
            const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const userSnap = await getDoc(doc(db, "users", activeNick));

            if (!userSnap.exists()) return;
            const userData = userSnap.data();

            const balance = userData.balance_ml || 0;
            document.getElementById("shopCurrentBalance").innerText = `Баланс: ${balance.toFixed(3)} мл`;

            const mainAvatarImg = document.getElementById("userAvatarImg");
            const previewAvatar = document.getElementById("shopPreviewAvatar");
            if (previewAvatar) {
                previewAvatar.src = (userData.avatarUrl && userData.avatarUrl !== "") ? userData.avatarUrl : (mainAvatarImg ? mainAvatarImg.src : "https://via.placeholder.com/80");
            }

            const unlocked = userData.unlockedFrames || ["default"];
            const currentFrame = userData.selectedFrame || "default";

            applyBorderToElement(document.getElementById("shopPreviewBorder"), currentFrame);

            renderItemAction("default", 0, "Стандартная", unlocked, currentFrame);
            renderItemAction("red", 1.0, "Красная", unlocked, currentFrame);
            renderItemAction("purple", 1.0, "Фиолетовая", unlocked, currentFrame);
            renderItemAction("rainbow", 2.0, "Радужная", unlocked, currentFrame);

            // Сразу применяем рамку к аватару в профиле
            applyFrameToProfileAvatar(currentFrame);
        } catch (e) {
            console.error("Ошибка загрузки магазина:", e);
        }
    };

    function applyBorderToElement(el, frameName) {
        if (!el) return;
        el.dataset.frame = frameName;
        if (frameName === "red") el.style.borderColor = "#ff4d4d";
        else if (frameName === "purple") el.style.borderColor = "#9c27b0";
        else if (frameName === "rainbow") {
            // Цвет задается динамически в setInterval
        } else {
            el.style.borderColor = "#ffffff";
        }
    }

    function applyFrameToProfileAvatar(frameName) {
        const profileWrap = document.querySelector(".drawer-avatar-wrap");
        if (!profileWrap) return;
        profileWrap.dataset.frame = frameName;
        if (frameName === "red") profileWrap.style.borderColor = "#ff4d4d";
        else if (frameName === "purple") profileWrap.style.borderColor = "#9c27b0";
        else if (frameName === "default") profileWrap.style.borderColor = "#ffffff";
    }

    function renderItemAction(frameId, price, name, unlocked, current) {
        const container = document.getElementById(`action_${frameId}`);
        if (!container) return;

        const hasIt = unlocked.includes(frameId);
        const isSelected = (current === frameId);

        if (isSelected) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-gray" disabled>Выбрано ✅</button>`;
        } else if (hasIt) {
            container.innerHTML = `<button class="btn-mini-action btn-mini-success" onclick="applyAndSaveFrame('${frameId}')">Выбрать</button>`;
        } else {
            container.innerHTML = `<button class="btn-mini-action" onclick="buyAndUnlockFrame('${frameId}', ${price})">Купить (${price} мл)</button>`;
        }
    }

    window.buyAndUnlockFrame = async function(frameId, price) {
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        if (!activeNick) {
            alert("Сначала войдите в аккаунт!");
            return;
        }

        try {
            const { getFirestore, doc, getDoc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const userRef = doc(db, "users", activeNick);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) return;
            const userData = userSnap.data();
            const currentBalance = userData.balance_ml || 0;

            if (currentBalance < price) {
                alert("❌ Недостаточно миллилитров в банке!");
                return;
            }

            const newBalance = currentBalance - price;
            let unlocked = userData.unlockedFrames || ["default"];
            if (!unlocked.includes(frameId)) unlocked.push(frameId);

            await updateDoc(userRef, {
                balance_ml: newBalance,
                unlockedFrames: unlocked,
                selectedFrame: frameId
            });

            window.totalBank = newBalance;
            localStorage.setItem("egg_total_ml_bank", newBalance.toFixed(3));
            if (window.currentUserData) {
                window.currentUserData.balance_ml = newBalance;
                window.currentUserData.unlockedFrames = unlocked;
                window.currentUserData.selectedFrame = frameId;
            }

            await window.updateShopUI();
            alert("🎉 Рамка успешно куплена и установлена!");
        } catch (e) {
            alert("Ошибка при покупке: " + e.message);
        }
    };

    window.applyAndSaveFrame = async function(frameId) {
        const activeNick = localStorage.getItem("egg_logged_in_nick");
        if (!activeNick) return;

        try {
            const { getFirestore, doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const db = getFirestore();
            const userRef = doc(db, "users", activeNick);

            await updateDoc(userRef, {
                selectedFrame: frameId
            });

            if (window.currentUserData) {
                window.currentUserData.selectedFrame = frameId;
            }

            await window.updateShopUI();
            alert("✅ Рамка успешно применена!");
        } catch (e) {
            alert("Ошибка выбора рамки: " + e.message);
        }
    };

    setTimeout(() => {
        injectShopButton();
        createShopDrawer();
    }, 1000);
})();
