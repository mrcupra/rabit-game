# الأرنوبة الشقية 🐰🥕 (v14 — Web, cPanel & Flutter iOS/Android)

لعبة **الأرنوبة الشقية** بتصميم 5D ودعم كامل للموبايل (بالطول والعرض) والكمبيوتر:
- **3 طرق لعب مختلفة:** الجري والقفز الكلاسيكي، الطيران النفاث والليزر، وتزلج الـ 3 مسارات.
- **طور القصة:** 100 مرحلة + معارك زعماء.
- **طور المقالب (Level Devil):** 200 مرحلة ذكية مليئة بالمقالب والفخاخ المتحركة والأرضيات المنهارة.
- **سباقات أونلاين، شحن جواهر، عشائر، باتل باس، وعجلة حظ.**

## بناء ملف الآيفون `.ipa` تلقائياً عبر GitHub Actions
يحتوي المستودع على ملف [`.github/workflows/build-ios-ipa.yml`](.github/workflows/build-ios-ipa.yml) لبناء تطبيق Flutter على `macos-latest` وإخراج ملف **`Arnouba_Game_iOS.ipa`** بدون الحاجة لجهاز ماك:
1. افتح تبويب **Actions** في مستودع GitHub.
2. اختر أحدث تشغيل للـ Workflow **`Build iOS IPA (Unsigned)`** (أو اضغط **Run workflow**).
3. بعد انتهاء البناء، نزّل الـ Artifact باسم **`Arnouba_Game_iOS`**.
4. ثبّت ملف `.ipa` على الآيفون باستخدام **Sideloadly** أو **AltStore** أو **ESign** أو **TrollStore**.

## التشغيل محلياً عبر Flutter
```bash
flutter pub get
flutter run
```
