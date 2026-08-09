# Android-обёртка

Игра работает в WebView и грузится из `assets/www` через `WebViewAssetLoader`
по адресу `https://appassets.androidplatform.net/`.

**Почему не file://** — игра собрана из ES-модулей, а по `file://` браузер их
не загружает из-за политики origin. Тот же приём используется в Тупике.

## Как собрать

APK собирается в GitHub Actions при каждом пуше в `main`:

1. Вкладка **Actions** → последний запуск **Build APK**
2. Внизу раздел **Artifacts** → `stronghold-apk`
3. Скачать zip, внутри `stronghold-N.apk`, установить на телефон

Локально ничего ставить не нужно: JDK, Android SDK и Gradle поднимаются
на стороне Actions.

## Что внутри

| Файл | Назначение |
|---|---|
| `app/src/main/java/game/stronghold/MainActivity.java` | WebView, полноэкранный режим, выход по кнопке «назад» |
| `app/build.gradle` | applicationId `game.stronghold`, minSdk 24, targetSdk 34 |
| `app/src/main/res/mipmap-*/ic_launcher.png` | иконка, генерируется из спрайта донжона |

## Что дальше

- Подпись релизного APK: keystore в секретах репозитория, отдельная задача
  `assembleRelease` — делается перед публикацией в RuStore
- Версия приложения правится в `app/build.gradle` (`versionCode`, `versionName`)
