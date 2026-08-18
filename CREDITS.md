# المصادر والتراخيص

## الأفاتار الحالي — `public/models/majed.glb`

مبني على **"Arab Man -RIGGED-"** لـ [NABEEL619](https://sketchfab.com/NABEEL619)
· [صفحة الموديل](https://sketchfab.com/3d-models/arab-man-rigged-0f87f4c0885346ad8f99ba5ccafd153e)
· رخصة [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)

الموديل الأصلي معمول في Ready Player Me ومصدّر **من غير morph targets**.
الـ ٧٢ blendshape (١٥ viseme + ٥٢ ARKit) اتنقلوا عليه بـ
[`tools/transfer_morphs.py`](tools/transfer_morphs.py) من أفاتار RPM تاني —
ينفع لأن كل أفاتارات RPM بتشترك في نفس الـ base mesh بنفس ترتيب الـ vertices.

مصدر الـ blendshapes: `brunette.glb` من
[met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead)،
معمول في Ready Player Me ومرخّص
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) —
**يعني الأفاتار ده للاستخدام غير التجاري.**

## بدائل

| الموديل | المصدر | الرخصة | تجاري؟ |
|---|---|---|---|
| `majed-rocketbox.glb` | [Microsoft RocketBox](https://github.com/microsoft/Microsoft-Rocketbox) | MIT | ✅ |
| `majed.glb` | Sketchfab + RPM blendshapes | CC-BY + CC BY-NC | ❌ |
| `majed-meshy.glb` | Meshy (بتاعك) | بتاعك | ✅ |

لو المشروع هيبقى تجاري، استخدم RocketBox:

```bash
python3 tools/rocketbox_to_glb.py --fetch Male_Adult_19 public/models/majed.glb
```

## الكود

three.js (MIT) · Express (MIT) · باقي الاعتماديات في `package.json`.
