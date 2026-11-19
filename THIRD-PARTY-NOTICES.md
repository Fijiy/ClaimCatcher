# Third-party notices

ClaimCatcher bundles, or was built from, the data, models, libraries and typeface below. Each entry gives its licence, who made it and where it came from; the licence texts are at the end. Everything else in ClaimCatcher is the entrant's own work. Not part of the package: Gemini Nano (local mode's model comes with Google Chrome) and Venice (the cloud service the viewer brings a key for).

This file is generated from `src/notices.ts` by `pnpm notices`. The build fails if it bundles an npm package or a model this file does not list, or if this file is out of date.

## Ratings data

### Media Bias/Fact Check (MBFC)

- Licence: No open licence: used with attribution under MBFC’s fair-use policy
- By: Media Bias/Fact Check, LLC, via the data of the official MBFC browser extension
- Copyright: Ratings © Media Bias/Fact Check, LLC (https://mediabiasfactcheck.com)
- From: https://mediabiasfactcheck.com
- Copy from: https://github.com/drmikecrowe/mbfcext
- Snapshot: drmikecrowe/mbfcext docs/csources.json at commit 60b0390730c32f2f367c0e6a4834ade39670bdcf, of 2026-10-24 (the file last changed upstream on 2022-01-23): https://raw.githubusercontent.com/drmikecrowe/mbfcext/60b0390730c32f2f367c0e6a4834ade39670bdcf/docs/csources.json
- Used for: Bias and factual-reporting ratings for news sites, bundled as a snapshot and looked up on the device.
- Note: MBFC’s ratings are not covered by the mbfcext repository’s MIT licence, which covers only its code (none of which ClaimCatcher uses). MBFC asks for clear attribution with a link, and use beyond fair use needs its permission. This must be settled with MBFC before ClaimCatcher is published in the Chrome Web Store.

## Models

### Moonshine base

- Licence: MIT License
- By: Useful Sensors (Moonshine AI)
- Copyright: Copyright (c) 2025 Useful Sensors, Inc. (dba Moonshine AI)
- From: https://github.com/moonshine-ai/moonshine
- Copy from: https://huggingface.co/onnx-community/moonshine-base-ONNX (ONNX conversion of https://huggingface.co/UsefulSensors/moonshine-base)
- Revision: b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad
- Used for: Speech-to-text on the device when a video has no captions (8-bit encoder and merged decoder).

### claimbuster-detector

- Licence: MIT License
- By: Mohammad Sachal Jawad
- Copyright: Copyright (c) 2026 M Sachal Jawad
- From: https://huggingface.co/sachaljawad/claimbuster-detector
- Revision: 9a3dcd45a212a06a04139863654717bc4743daba
- Used for: The claim filter: scores each sentence for whether it is a check-worthy claim. Exported to ONNX and quantized to 8 bits by scripts/claim-filter/export.py.
- Note: Fine-tuned from DistilBERT base uncased on the ClaimBuster dataset (both listed here).
- Note: The model card gives the MIT licence; the copyright line is from the licence of its code, https://github.com/sachaljawad/DebateIQ.

### DistilBERT base uncased

- Licence: Apache License 2.0
- By: Hugging Face
- Copyright: Hugging Face (Sanh, Debut, Chaumond and Wolf, 2019)
- From: https://huggingface.co/distilbert/distilbert-base-uncased
- Used for: The base model claimbuster-detector was fine-tuned from; its weights and tokenizer are part of the claim filter.

### pyannote segmentation-3.0

- Licence: MIT License
- By: pyannote (Hervé Bredin and Alexis Plaquet, CNRS)
- Copyright: Copyright (c) 2020 CNRS
- From: https://huggingface.co/pyannote/segmentation-3.0
- Copy from: https://huggingface.co/onnx-community/pyannote-segmentation-3.0 (ONNX conversion)
- Revision: 733a93b6473d019a773298e08cefa686894b1854
- Used for: Telling voices apart on the device: finds where each voice speaks (8-bit).

### WeSpeaker ResNet34

- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0)
- By: WeSpeaker (wenet-e2e)
- Copyright: wespeaker-voxceleb-resnet34-LM by the WeSpeaker team (https://github.com/wenet-e2e/wespeaker), trained on VoxCeleb
- From: https://github.com/wenet-e2e/wespeaker
- Copy from: https://huggingface.co/onnx-community/wespeaker-voxceleb-resnet34-LM (ONNX conversion of https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM)
- Revision: 6a61a1833ff2583aabeba044f5c8221f00b67ceb
- Used for: Telling voices apart on the device: a voice print for each stretch of speech (8-bit).
- Note: Changed from the original: converted to ONNX and quantized to 8 bits (by onnx-community).

## Datasets (not bundled; the models above were trained on them)

### ClaimBuster dataset

- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0)
- By: Fatma Arslan, Naeemul Hassan, Chengkai Li and Mark Tremayne
- Copyright: Arslan, F., Hassan, N., Li, C. and Tremayne, M. (2020). A Benchmark Dataset of Check-worthy Factual Claims. ICWSM 14, 821–829. Data: https://doi.org/10.5281/zenodo.3609356
- From: https://doi.org/10.5281/zenodo.3609356
- Used for: The data claimbuster-detector was trained on. The dataset itself is not bundled.
- Note: Its sentences were relabelled for training: check-worthy factual sentences as check-worthy, the rest as not (see the model card).

## Libraries

### Transformers.js

- Licence: Apache License 2.0
- By: Hugging Face
- Copyright: Copyright Hugging Face
- From: https://github.com/huggingface/transformers.js
- Version: @huggingface/transformers 4.3.1 (npm)
- Used for: Runs the on-device models.

### Tokenizers.js

- Licence: Apache License 2.0
- By: Hugging Face
- Copyright: Copyright Hugging Face
- From: https://github.com/huggingface/tokenizers.js
- Version: @huggingface/tokenizers 0.2.0 (npm)
- Used for: Tokenizers for the on-device models (compiled into Transformers.js).

### @huggingface/jinja

- Licence: MIT License
- By: Hugging Face
- Copyright: Copyright (c) 2023 Hugging Face
- From: https://github.com/huggingface/huggingface.js/tree/main/packages/jinja
- Version: @huggingface/jinja 0.5.10 (npm)
- Used for: Template engine (compiled into Transformers.js).

### ONNX Runtime Web

- Licence: MIT License
- By: Microsoft
- Copyright: Copyright (c) Microsoft Corporation
- From: https://github.com/microsoft/onnxruntime
- Version: onnxruntime-web 1.31.0-dev.20260914-8d85527a0; onnxruntime-common 1.31.0-dev.20260911-2a43ec07e (npm)
- Used for: Runs the models in WebAssembly and WebGPU (the JavaScript and the asyncify WASM build).
- Note: The WASM build includes libraries compiled into ONNX Runtime; they are listed in its ThirdPartyNotices.txt: https://github.com/microsoft/onnxruntime/blob/main/ThirdPartyNotices.txt

### WXT

- Licence: MIT License
- By: Aaron Klinker
- Copyright: Copyright (c) 2023 Aaron
- From: https://github.com/wxt-dev/wxt
- Version: wxt 0.21.5; @wxt-dev/browser 0.3.6 (npm)
- Used for: The extension framework: builds the extension; its small runtime helpers and browser API wrapper are bundled.

### Svelte

- Licence: MIT License
- By: the Svelte contributors
- Copyright: Copyright (c) 2016-2025 Svelte Contributors (https://github.com/sveltejs/svelte/graphs/contributors)
- From: https://github.com/sveltejs/svelte
- Version: svelte 5.57.2 (npm)
- Used for: The side panel, the first-run page and Privacy & data are Svelte components.

## Typeface

### Atkinson Hyperlegible Next

- Licence: SIL Open Font License 1.1
- By: the Braille Institute
- Copyright: Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)
- From: https://github.com/googlefonts/atkinson-hyperlegible-next
- Copy from: https://fontsource.org/fonts/atkinson-hyperlegible-next (variable weight, Latin and Latin Extended)
- Version: @fontsource-variable/atkinson-hyperlegible-next 5.3.0 (npm)
- Used for: The typeface of every page.

## Licence texts

#### No open licence: used with attribution under MBFC’s fair-use policy

MBFC's fair-use policy: https://mediabiasfactcheck.com/fair-use-policy/

#### MIT License

Applies with each MIT entry's copyright line above.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

#### Apache License 2.0

```

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

#### Creative Commons Attribution 4.0 International (CC BY 4.0)

The full legal code: https://creativecommons.org/licenses/by/4.0/legalcode

#### SIL Open Font License 1.1

```
Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next) AtkinsonHyperlegibleNext-Italic[wght].ttf: Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
