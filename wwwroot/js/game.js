document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    const gameWidth = 1200;
    const gameHeight = 600;
    canvas.width = gameWidth;
    canvas.height = gameHeight;

    // Resim kaynakları
    const images = {};
    const imageSources = {
        player_frames: [], // Oyuncu animasyon kareleri için boş bir dizi
        obstacle: '/images/obstacle.png',
        background: '/images/background.png'
    };

    // Oyuncu animasyon karelerini doldur
    for (let i = 0; i < 5; i++) { // Kare sayısı 5'e düşürüldü
        imageSources.player_frames.push(`/images/player_frames/player_frames_${i}.png`); // Dosya adı düzeltildi
    }
    let imagesLoaded = 0;
    const numImages = Object.keys(imageSources).length;

    // Resimleri Promise.all ile garantili yükle
    function loadImages() {
        const promises = [];
        images.player_frames = []; // Yüklenen oyuncu resimlerini saklamak için

        Object.keys(imageSources).forEach(key => {
            if (key === 'player_frames') {
                imageSources.player_frames.forEach(src => {
                    promises.push(new Promise((resolve, reject) => {
                        const img = new Image();
                        img.src = src;
                        img.onload = () => {
                            images.player_frames.push(img);
                            resolve(img);
                        };
                        img.onerror = () => reject(new Error(`Resim yüklenemedi: ${src}`));
                    }));
                });
            } else {
                promises.push(new Promise((resolve, reject) => {
                    const img = new Image();
                    img.src = imageSources[key];
                    img.onload = () => {
                        images[key] = img;
                        // Background yüklendiğinde ölçeklemeyi ve oynanabilir alanı hesapla
                        if (key === 'background') {
                            calculateBackgroundScale();
                            calculatePlayAreaFromBackground();
                        }
                        resolve(img);
                    };
                    img.onerror = () => reject(new Error(`Resim yüklenemedi: ${imageSources[key]}`));
                }));
            }
        });

        return Promise.all(promises);
    }

    // Oynanabilir alan sınırları - background resmindeki duvarlara göre ayarlanacak
    // Background resmi analiz edildi: üst duvar ~%22, alt duvar ~%22, ortadaki oynanabilir alan ~%56
    let topPadding = 50;
    let bottomPadding = 50;
    
    // Background'a göre padding'leri ayarlama fonksiyonu
    function calculatePlayAreaFromBackground() {
        if (!images.background || !images.background.complete) return;
        
        // Background resmindeki duvar oranları (resim analiz edilerek belirlendi)
        // Üst bej duvar: resmin yaklaşık %22'si
        // Alt bej duvar: resmin yaklaşık %22'si  
        // Ortadaki şehir manzarası (oynanabilir alan): resmin yaklaşık %56'sı
        const topWallPercent = 0.28;
        const bottomWallPercent = 0.28;
        
        // Canvas yüksekliğine göre hesapla
        topPadding = Math.round(gameHeight * topWallPercent);
        bottomPadding = Math.round(gameHeight * bottomWallPercent);
        
        console.log(`Oynanabilir alan ayarlandı - Top: ${topPadding}px, Bottom: ${bottomPadding}px`);
        console.log(`Oynanabilir yükseklik: ${gameHeight - topPadding - bottomPadding}px`);
    }

    const player = {
        x: 150,
        y: gameHeight - bottomPadding - 45,
        width: 45,      // Karakterin oyundaki GÖRÜNEN genişliği (küçültüldü)
        height: 45,     // Karakterin oyundaki GÖRÜNEN yüksekliği (küçültüldü)
        velocityY: 0,
        gravity: 0.5,
        isGravityFlipped: false,
        // Animasyon için eklendi
        spriteWidth: 40, // Sprite resmindeki BİR KARENİN gerçek genişliği (320px / 8 frame = 40px)
        spriteHeight: 40, // Sprite resmindeki BİR KARENİN gerçek yüksekliği
        totalFrames: 5, // Toplam frame sayısı (resme göre güncellendi)
        frameX: 0, 
        gameFrame: 0, 
        staggerFrames: 12, 
        state: 'running'
    };

    let score = 0;
    let highScore = localStorage.getItem('highScore') || 0;
    let obstacles = [];
    let frameCount = 0;
    let gameSpeed = 1.5; // Oyun hızı daha da yavaşlatıldı
    let isGameOver = false;
    let gameStarted = false;
    let backgroundX = 0;

    function drawStartScreen() {
        drawBackground();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, gameWidth, gameHeight);
        ctx.fillStyle = '#0ff';
        ctx.font = '30px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('Oyuna Başlamak İçin Tıkla', gameWidth / 2, gameHeight / 2 - 20);
        ctx.font = '24px Orbitron';
        ctx.fillText('veya Space Tuşuna Bas', gameWidth / 2, gameHeight / 2 + 20);
        drawWalls();
    }

    function drawGameOverScreen() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, gameWidth, gameHeight);
        ctx.fillStyle = '#ff0000';
        ctx.font = '50px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('Game Over', gameWidth / 2, gameHeight / 2 - 60);
        ctx.fillStyle = '#fff';
        ctx.font = '30px Orbitron';
        ctx.fillText(`Skor: ${score}`, gameWidth / 2, gameHeight / 2);
        ctx.fillStyle = '#0ff';
        ctx.font = '20px Orbitron';
        ctx.fillText('Tekrar Oynamak İçin Tıkla', gameWidth / 2, gameHeight / 2 + 50);
    }

    // Background ölçekleme bilgileri
    let backgroundScale = 1;
    let backgroundDisplayWidth = 0;
    let backgroundDisplayHeight = 0;
    
    // Background pozisyonu (contain modu için)
    let backgroundOffsetX = 0;
    let backgroundOffsetY = 0;
    
    function calculateBackgroundScale() {
        if (!images.background || !images.background.complete) return;
        
        const bgWidth = images.background.width;
        const bgHeight = images.background.height;
        
        // Background'u canvas'a tam sığdır (cover modu - yüksekliğe göre)
        // Yüksekliğe göre ölçekle, genişlik taşarsa sorun yok (kayan arka plan)
        backgroundScale = gameHeight / bgHeight;
        
        backgroundDisplayWidth = bgWidth * backgroundScale;
        backgroundDisplayHeight = gameHeight; // Tam yükseklik
        
        // Dikey ortalama (yatay kaydırma için offset 0)
        backgroundOffsetX = 0;
        backgroundOffsetY = 0;
        
        console.log(`Background ölçeklendi - Orijinal: ${bgWidth}x${bgHeight}`);
        console.log(`Görünen: ${backgroundDisplayWidth.toFixed(0)}x${backgroundDisplayHeight}px, Scale: ${backgroundScale.toFixed(2)}`);
    }
    
    function drawBackground() {
        if (!images.background || !images.background.complete) return;
        
        const drawHeight = backgroundDisplayHeight || gameHeight;
        const drawWidth = backgroundDisplayWidth || gameWidth;
        
        // Background'u "contain" modunda çiz - kesilmeden tam görünsün
        // Sonsuz kayan arka plan için birden fazla kopya çiz
        
        // Canvas'ın genişliğini kaplamak için gerekli kopya sayısını hesapla
        // Eğer background genişliği canvas'tan küçükse, daha fazla kopya gerekir
        const copiesNeeded = drawWidth > 0 ? Math.ceil(gameWidth / drawWidth) + 2 : 1;
        
        // Her bir kopyayı çiz
        for (let i = -1; i <= copiesNeeded; i++) {
            const xPos = backgroundOffsetX + backgroundX + (i * drawWidth);
            const yPos = backgroundOffsetY;
            
            // Sadece canvas içinde görünen kısımları çiz
            // Background'un tamamı görünsün, hiçbir kısmı kesilmesin
            if (xPos + drawWidth > 0 && xPos < gameWidth) {
                // Background'un tamamını çiz - kesilmeden
                ctx.drawImage(
                    images.background,
                    0, 0, images.background.width, images.background.height,
                    xPos, yPos, drawWidth, drawHeight
                );
            }
        }
        
        // Arka plan kaydırma
        backgroundX -= gameSpeed / 4;
        if (backgroundX <= -drawWidth) {
            backgroundX += drawWidth;
        }
        if (backgroundX >= drawWidth) {
            backgroundX -= drawWidth;
        }
    }

    function drawWalls() {
        // Duvarlar artık background resminde görünüyor, ekstra çizim gerekmiyor
        // Sadece oynanabilir alan sınırları için görünmez duvarlar var
    }

    function drawPlayer() {
        // Yüklenecek resimler dizisi var mı ve dolu mu diye kontrol et
        if (!images.player_frames || images.player_frames.length === 0) return;

        // Geçerli frame'i al
        const currentFrame = images.player_frames[player.frameX];
        if (!currentFrame || !currentFrame.complete) return;

        // Canvas transformasyonunu kaydet
        ctx.save();

        // Yerçekimi tersine döndüğünde resmi dikey olarak çevir
        if (player.isGravityFlipped) {
            ctx.translate(player.x + player.width / 2, player.y + player.height / 2);
            ctx.scale(1, -1); // Dikey çevirme
            ctx.translate(-(player.x + player.width / 2), -(player.y + player.height / 2));
        }

        // Resmi çiz
        ctx.drawImage(currentFrame, player.x, player.y, player.width, player.height);

        // Canvas transformasyonunu geri yükle
        ctx.restore();
    }

    function updatePlayer() {
        // Fizik güncellemeleri
        player.velocityY += player.gravity;
        player.y += player.velocityY;

        // Zemin ve tavan kontrolü
        const onGround = player.y >= gameHeight - bottomPadding - player.height;
        const onCeiling = player.y <= topPadding;

        if (!player.isGravityFlipped) {
            if (onGround) {
                player.y = gameHeight - bottomPadding - player.height;
                player.velocityY = 0;
                player.state = 'running';
            } else {
                player.state = 'jumping';
            }
        } else {
            if (onCeiling) {
                player.y = topPadding;
                player.velocityY = 0;
                player.state = 'running'; // Ters yerçekiminde tavanda koşuyor
            } else {
                player.state = 'jumping';
            }
        }

        // Animasyon karesi güncellemesi
        if (player.state === 'running') {
            // Koşma animasyonu (ilk 4 kare, 0-3)
            if (player.gameFrame % player.staggerFrames === 0) {
                if (player.frameX < 3) {
                    player.frameX++;
                } else {
                    player.frameX = 0;
                }
            }
        } else {
            // Zıplama/Düşme animasyonu (5. kare, index 4)
            // 8 frame olduğu için frame 4 kullanılabilir
            player.frameX = Math.min(4, player.totalFrames - 1);
        }
        
        player.gameFrame++;
    }

    function drawObstacles() {
        if (!images.obstacle || !images.obstacle.complete) return;
        obstacles.forEach(obstacle => {
            ctx.drawImage(images.obstacle, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        });
    }

    function updateObstacles() {
        frameCount++;
        if (frameCount % 100 === 0) {
            const obstacleWidth = 50; // Engeller genişletildi
            const obstacleHeight = Math.random() * 60 + 40; // Engeller kısaltıldı

            let y;
            if (Math.random() > 0.5) { // Tavandan
                y = topPadding;
            } else { // Zeminden
                y = gameHeight - bottomPadding - obstacleHeight;
            }
            obstacles.push({ x: gameWidth, y: y, width: obstacleWidth, height: obstacleHeight });
        }

        obstacles.forEach(obstacle => {
            obstacle.x -= gameSpeed;
        });

        obstacles = obstacles.filter(obstacle => obstacle.x + obstacle.width > 0);
    }

    function checkCollision() {
        for (const obstacle of obstacles) {
            if (
                player.x < obstacle.x + obstacle.width &&
                player.x + player.width > obstacle.x &&
                player.y < obstacle.y + obstacle.height &&
                player.y + player.height > obstacle.y
            ) {
                gameOver();
            }
        }
        // Bu kontrol hatalıydı, çünkü karakterin normalde de bu sınırlara dokunması gerekiyor.
        // Gerçek çarpışma kontrolü updatePlayer içinde yapılıyor.
        // if (player.y + player.height > gameHeight - bottomPadding || player.y < topPadding) {
        //      gameOver();
        // }
    }

    function drawScore() {
        ctx.fillStyle = '#fff';
        ctx.font = '24px Orbitron';
        ctx.textAlign = 'right';
        ctx.fillText(`Skor: ${score}`, gameWidth - 20, 40);
        ctx.textAlign = 'left';
        ctx.fillText(`En Yüksek: ${highScore}`, 20, 40);
    }

    function updateScore() {
        score++;
        if (score > highScore) {
            highScore = score;
            localStorage.setItem('highScore', highScore);
        }
        if (score % 500 === 0) {
            gameSpeed += 0.5;
        }
    }

    function switchGravity() {
        if (isGameOver || !gameStarted) return;
        player.isGravityFlipped = !player.isGravityFlipped;
        player.gravity *= -1;
        // Yerçekimi değiştirme hızı daha da yumuşatıldı (çok daha yavaş geçiş)
        player.velocityY = player.isGravityFlipped ? 0.5 : -0.5;
    }

    function gameOver() {
        isGameOver = true;
        gameSpeed = 2; // Oyun hızı yavaşlatıldı
        drawGameOverScreen();
    }

    function resetGame() {
        player.y = gameHeight - bottomPadding - player.height;
        player.velocityY = 0;
        player.isGravityFlipped = false;
        player.gravity = Math.abs(player.gravity);
        if (player.gravity < 0) player.gravity *= -1;

        obstacles = [];
        score = 0;
        frameCount = 0;
        isGameOver = false;
        gameStarted = true;
        gameLoop();
    }

    function gameLoop() {
        if (isGameOver) {
            drawGameOverScreen();
            return;
        }

        ctx.clearRect(0, 0, gameWidth, gameHeight);
        drawBackground();
        drawWalls();
        updatePlayer();
        drawPlayer();
        updateObstacles();
        drawObstacles();
        checkCollision();
        updateScore();
        drawScore();

        requestAnimationFrame(gameLoop);
    }

    function handleStart(e) {
        if (!gameStarted) {
            e.preventDefault();
            gameStarted = true;
            resetGame();
        } else if (isGameOver) {
            resetGame();
        } else {
            switchGravity();
        }
    }

    // Oyunu Başlat
    loadImages()
        .then(() => {
            // Resimler başarıyla yüklendi, şimdi olay dinleyicilerini ekle ve başlangıç ekranını çiz
            drawStartScreen();
            window.addEventListener('keydown', (e) => {
                if (e.code === 'Space') {
                    handleStart(e);
                }
            });
            canvas.addEventListener('mousedown', handleStart);
        })
        .catch(error => {
            console.error("Oyun başlatılamadı: Resimler yüklenirken bir hata oluştu.");
            console.error(error);
        });
});
