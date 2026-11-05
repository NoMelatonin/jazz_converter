# Local video transcription components

Installed on demand into the app's private data directory. No cloud inference.

- UV 0.13.7, Astral: MIT/Apache-2.0. https://github.com/astral-sh/uv
- CPython 3.11.18 via python-build-standalone: PSF and bundled dependency notices. https://github.com/astral-sh/python-build-standalone
- piano-transcription-inference 0.0.6: MIT classifier in upstream package metadata. https://github.com/qiuqiangkong/piano_transcription_inference
- Kong et al., High-resolution Piano Transcription with Pedals by Regressing Onset and Offset Times (2021). Pretrained weights: https://zenodo.org/records/4034264, CC BY 4.0 as recorded by Zenodo metadata. https://creativecommons.org/licenses/by/4.0/
- Model SHA-256: c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141
- PyTorch 2.2.2: BSD-style license. https://github.com/pytorch/pytorch
- OpenCV 4.10.0: Apache-2.0. https://github.com/opencv/opencv
- yt-dlp 2026.10.26: Unlicense; yt-dlp-ejs and its dependencies have their own notices. https://github.com/yt-dlp/yt-dlp
- imageio-ffmpeg 0.6.0: BSD-2-Clause wrapper; its bundled FFmpeg binary is GPL. FFmpeg sources/build details and licenses: https://github.com/imageio/imageio-ffmpeg and https://github.com/BtbN/FFmpeg-Builds, https://ffmpeg.org/legal.html

The installer downloads official published distributions; their LICENSE and dist-info metadata stay in the private runtime. The pinned dependency set and accepted distribution hashes are in requirements.txt. Model weights are unmodified. Feature code only runs inference and translates output events.

Video rights are independent of model/software licenses. A publicly reachable video does not establish a license for the music or arrangement. The app preserves the URL or local source filename and labels all derived notes as a transcription.
