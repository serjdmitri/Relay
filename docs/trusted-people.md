# Trusted people

General → Trusted people: enroll your own face first (“enroll my face”), then enter a person's name and choose Enroll person. macOS asks for device-owner authentication before enrollment or removal. Only the person being enrolled should face the camera; slowly turn and tilt their head. Cancel enrollment stops without saving. Enrollment expires after two minutes. At most eight named profiles are supported.

Templates remain encrypted using Electron safeStorage on this Mac, outside public state broadcasts. Matching uses the existing local SFace pipeline. Names and enrollment dates appear in Settings. Forgetting the owner also removes trusted profiles and disables recognition. Owner replacement, forgetting, disabling recognition or disabling liveness require macOS authentication.

This is webcam recognition, not Apple Face ID. Video replay and recognition errors remain possible. It only locks the Mac; macOS still controls unlocking. The separate second-viewer guard counts faces regardless of identity. Enrolling family does not override that option.

Verified: helper compiles against macOS LocalAuthentication; 24 profile/owner tests passed, including denied authentication, concurrent requests, invalid data and targeted removal. No physical enrollment, Touch ID/password prompt or recognition accuracy was tested automatically. Those require the owner and enrolled people present.
