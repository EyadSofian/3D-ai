# ماجد — أفاتار ثلاثي الأبعاد بيتكلم عربي

بيسمعك → بيحوّل كلامك لنص → بيبعته لموديل → بينطق الرد بصوت → **وشفايفه بتتحرك على الصوت الحقيقي**.

```bash
npm install
cp .env.example .env      # وحط المفاتيح
npm start                 # http://localhost:5178
```

---

## إزاي الشفايف بتتزامن

معظم الأكواد الجاهزة بتخمّن التوقيت من عدد حروف النص. دا بيـ drift، وفي العربي بيبقى
عشوائي تمامًا لأن جداول الـ visemes بتاعتهم لاتينية. هنا طبقتين مربوطين بالصوت نفسه:

**طبقة (أ) — شكل الفم.** ElevenLabs بيرجّع مع الصوت `character_start_times_seconds` لكل
حرف. `visemes-ar.js` بيحوّل كل حرف عربي لمخرجه الحقيقي في النطق المصري:

| الحروف | الشكل | ليه |
|---|---|---|
| ب م | `PP` | الشفايف بتتقفل |
| ف | `FF` | الشفة تحت على السنان |
| و | `U` | الشفايف بتتدوّر |
| ش | `CH` | الشفايف بتبرز |
| س ص ز ظ | `SS` | الشفايف بتتفرد وتضيق |
| ا ع ح ه ء | `aa` | الفم بيتفتح |
| ي | `I` | فرد أفقي |
| ت ط د ض | `DD` | اللسان على اللثة |
| ث ذ | `TH` | اللسان بين السنان |
| ك ق خ غ ج | `kk` | مخرج خلفي |
| ر | `RR` · ل ن | `nn` |

وسوم الأداء (`[يهمس]`) بتتشال قبل حساب الشفايف وقبل العرض — عشان الفم ينطق
الكلام مش اسم الوسم.

والحركات بتغلب الحرف: `كُتِب` → `kk U DD I`. والسكون والشدّة بيمدّوا الشكل اللي قبلهم.

**طبقة (ب) — مقدار الفتح.** الصوت بيتشغّل عن طريق `AudioContext` → `AnalyserNode`،
فالسعة اللحظية بتعدّل فتحة الفك كل frame. والأهم: موضع التشغيل بيتقرا من
`AudioContext.currentTime`، يعني **الـ drift مستحيل** — مفيش مؤقّت بيجري جنب الصوت.

> علشان كده مش بنستخدم `speechSynthesis`: مبيديكش أي stream تقدر تحلله ولا توقيتات
> حقيقية، فمفيش قدامك غير التخمين.

---

## المسار كامل

```
مايك + VAD ──► /api/stt ──► ElevenLabs Scribe ──► نص عربي
                                                    │
                                                    ▼
                            /api/converse ──► OpenAI أو Claude (متدفّق)
                                                    │  جملة جملة
                                                    ▼
                                          ElevenLabs with-timestamps
                                                    │
                          ┌─────────────────────────┴───────────────────┐
                          ▼                                             ▼
                  AudioEngine (تشغيل + تحليل)              LipSync (جدول الـ visemes)
                          └─────────────────► Avatar ◄─────────────────┘
```

الجمل بتتبعت للـ TTS أول ما تخلص — مش بننتظر الرد كله. يعني الأفاتار بيبدأ يتكلم
وباقي الرد لسه بيتكتب.

---

## المفاتيح

### الصوت — ElevenLabs (موصى بيه) أو OpenAI

```env
VOICE_PROVIDER=          # فاضية = ElevenLabs لو مفتاحه موجود، وإلا OpenAI
```

| | ElevenLabs | OpenAI |
|---|---|---|
| جودة الصوت العربي | ممتازة | كويسة |
| وسوم أداء `[يهمس]` `[يضحك]` | ✅ (`eleven_v3`) | ❌ |
| توقيت لكل حرف | ✅ **=> أدق lip sync** | ❌ |
| مفتاح زيادة | لازم | لأ — نفس مفتاح الموديل |

من غير توقيتات، الواجهة بتفك تشفير الصوت وتقرا **مدته الحقيقية** وتوزّع الحروف
عليها بأوزان (المدّ أطول من السواكن). الجملة بتخلص مع الصوت بالظبط، وطبقة السعة
بتصحّح الباقي — يعني كويسة جدًا، بس مش بدقة توقيت ElevenLabs.

#### مفتاح ElevenLabs
[elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys)

المفتاح **بيبدأ بـ `sk_`** وبيظهر مرة واحدة بس وقت الإنشاء أو التدوير. الرقم اللي ظاهر
في الصفحة تحت اسم المفتاح دا **الـ ID** مش المفتاح — لو نسخته هيرجّعلك:

```
API key ID used as API key - only valid API keys can be used
```

الحل: اضغط **Rotate** وانسخ المفتاح الجديد فورًا.

### الموديل اللي بيرد

```env
LLM_PROVIDER=openai        # أو anthropic
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini   # الأسرع للمحادثة الصوتية
```

سيب `LLM_PROVIDER` فاضية وهيختار لوحده حسب المفتاح الموجود.

---

## الأفاتار

الافتراضي `public/models/majed.glb` — شخصية **Male_Adult_19** من
[Microsoft RocketBox](https://github.com/microsoft/Microsoft-Rocketbox): راجل
عربي بدقن، ثوب وغترة وعقال. وفيه **٥٢ ARKit blendshape + ١٥ Oculus viseme
أصلية** ومعمولة بإيد فنان — يعني الفم بيتفتح على تجويف حقيقي فيه سنان ولسان،
مش تزييف على سطح مقفول.

**الترخيص MIT** — مجاني حتى للاستخدام التجاري، من غير أي اشتراك ولا خدمة برّه.

### تبديل الشخصية

فيه ١١٣ شخصية جاهزة. أمر واحد بينزّل ويحوّل:

```bash
python3 tools/rocketbox_to_glb.py --fetch Male_Adult_19 public/models/majed.glb
```

اللي فيهم دقن ولبس عربي: `Male_Adult_15` · `Male_Adult_19` · `Male_Adult_21`.
والباقي في [مجلد Avatars](https://github.com/microsoft/Microsoft-Rocketbox/tree/main/Assets/Avatars)
(`Male_Adult_01`…`21`، و`Business_Male_*`، `Medical_*`، `Police_*` …).

### تركيب blendshapes على أي أفاتار Ready Player Me

معظم أفاتارات RPM المنشورة على Sketchfab **مصدّرة من غير الـ morph targets** —
لأنها باراميتر اختياري في الرابط وأغلب الناس مش واخدة بالها منه. فبيبقى عندك
موديل حلو الفم فيه ميت.

الحل إن كل أفاتارات RPM مبنية على **نفس الـ base mesh بالظبط**:
`Wolf3D_Head` = 2162 vertex، `Wolf3D_Teeth` = 84، كل عين 120 — بنفس ترتيب
الـ vertices وبنفس الـ UV. يعني الـ blendshapes بتاعة أي أفاتار RPM بتركب على
أي أفاتار RPM تاني **حرفيًا**، مش تقريب:

```bash
python3 tools/transfer_morphs.py <فيه_blendshapes.glb> <موديلك.glb> <الناتج.glb>
```

الأداة بتتأكد الأول إن الـ indices والـ UV متطابقة وبتقف لو الموديلين مش نفس
القاعدة. النتيجة: ٧٢ morph target (١٥ viseme + ٥٢ ARKit) على موديل كان فاضي.

### ليه فيه محوّل مكتوب بالإيد

ملفات RocketBox بصيغة FBX بتاعة Unity، والمتصفح بيقرا GLB بس. المحوّلات
الجاهزة كلها محتاجة Blender أو binaries قديمة x86، فـ [`tools/fbx.py`](tools/fbx.py)
بيقرا الـ FBX binary خام و[`tools/rocketbox_to_glb.py`](tools/rocketbox_to_glb.py)
بيكتب الـ GLB — بـ Python وبس. بيعمل كمان:

- تحويل المحاور: 3ds Max بـ Z-up وبالسنتيمتر ➜ glTF بـ Y-up وبالمتر
- ترجمة الأسماء: `AA_VI_01_PP` ➜ `viseme_PP` · `AK_25_JawOpen` ➜ `jawOpen`
- TGA ١٢ ميجا للواحدة ➜ JPEG (الملف كله بقى ٥ ميجا)

### الموديل القديم

موديلك الأصلي من Meshy محفوظ في `public/models/majed-meshy.glb`، وأداة
[`tools/rig_avatar.py`](tools/rig_avatar.py) اللي بتركّب عليه شفايف لسه موجودة.
بس خد بالك من الفرق:

| | Meshy + rig_avatar | RocketBox |
|---|---|---|
| الفم بيتفتح | ❌ مرسوم على الـ texture | ✅ تجويف حقيقي |
| سنان ولسان | ❌ مرسومين | ✅ geometry منفصلة |
| رمش | ❌ العينين مرسومة | ✅ `eyeBlinkLeft/Right` |
| visemes | ٤ تشوّهات مولّدة | ١٥ أصلية بإيد فنان |
| الحجم | ٩٫١ ميجا | ٥٫٠ ميجا |

الموديلات المتاحة في `public/models/`:

| الملف | الشكل | ملاحظة |
|---|---|---|
| `majed.glb` | كرتوني (RPM) | الافتراضي — ثوب وغترة، بس نضارة ومن غير دقن |
| `majed-rocketbox.glb` | واقعي | عربي بدقن وثوب وغترة · MIT |
| `majed-meshy.glb` | كرتوني | موديلك الأصلي — الفم مبيتفتحش |

### لو عايز شبهك انت

الشخصيات دي جاهزة مش شخصية. لو عايز أفاتار من صورتك،
[Avaturn](https://avaturn.me/) بيعمل كده ببلاش للاستخدام غير التجاري وبيصدّر
GLB فيه نفس الـ ARKit blendshapes والـ visemes — يشتغل مع الكود من غير أي
تعديل، حط مساره في `AVATAR_URL` وبس.

> **Ready Player Me اتقفلت في ٣١ يناير ٢٠٢٦** بعد ما Netflix اشترتها — الموقع
> والـ APIs كلها offline. أي كود قديم بيستخدمها مش هيشتغل.

## الملفات

```
server/
  index.js            Express + SSE. المفاتيح كلها هنا، المتصفح مبيشوفش حاجة
  lib/llm.js          يختار OpenAI أو Claude — نفس الواجهة للاتنين
  lib/prompt.js       البرومبت + تقطيع الجمل للـ TTS
  lib/voice.js        يختار ElevenLabs أو OpenAI للصوت
  lib/elevenlabs.js   TTS بالتوقيتات + Scribe STT
  lib/openai-voice.js TTS + STT من OpenAI
  lib/tags.js         شيل وسوم الأداء
public/js/
  visemes-ar.js       ★ خريطة الحروف العربية → أشكال الفم
  lipsync.js          ★ الطبقتين: جدول زمني + سعة الصوت
  audio.js            Web Audio: تشغيل + تحليل + طابور
  avatar.js           three.js + قيادة الـ morph targets
  mic.js              getUserMedia + VAD + barge-in
tools/rig_avatar.py   تركيب blendshapes على موديل ساكن
public/selftest.html  ٢٠ اختبار للـ pipeline كامل
```

---

## اختبار

```bash
npm start
```

- `/selftest.html` — بيبني موديل اختبار، يحمّله بالكود الحقيقي، ويعدّي جملة عربية
  كاملة على المحرّك ويتأكد إن الفم بينطقها
- `/rigtest.html` — رندر للموديل على أشكال فم مختلفة

---

## حاجات مبنية جوه

- **barge-in** — لو اتكلمت وهو بيتكلم، بيسكت ويسمعك
- **echoCancellation** — من غيرها بيسمع صوت نفسه من السماعات ويرد على نفسه
- **VAD بأرضية ضوضاء متكيّفة** — بيشتغل في أوضة هادية وفي مكتب فيه دوشة
- **fallback عند الرفض** — لو الـ classifiers رفضت طلب، Claude بيعيده على موديل تاني
  بدل ما الأفاتار يقف
