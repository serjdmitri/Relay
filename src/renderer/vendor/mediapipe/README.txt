MediaPipe Tasks Vision 1.1.1 (Apache License 2.0, Google): vision_bundle.mjs and wasm/vision_wasm_internal.{js,wasm} from the @mediapipe/tasks-vision npm package.
gesture_recognizer.task (Apache License 2.0, Google): the hand and gesture model from https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task
Used by Hand control (camera) to find your hands and tell a fist, an open hand, a pinch and a peace sign apart. It runs entirely on this Mac: pictures from the camera are never saved or sent anywhere.
License text: https://www.apache.org/licenses/LICENSE-2.0
blaze_face_short_range.tflite (Apache License 2.0, Google): the face finder, from https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite
Used only by "Pause music when I leave the desk" (opt-in) to tell whether someone is in front of the camera: once a second it counts faces. Nothing is recognised, saved or sent.
