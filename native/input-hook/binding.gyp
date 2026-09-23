{
  "targets": [
    {
      "target_name": "input-hook",
      "sources": ["src/addon.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17"],
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": ["src/hook_win.cc"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++17", "/utf-8"]
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "sources": ["src/hook_mac.mm"],
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
              "MACOSX_DEPLOYMENT_TARGET": "11.0",
              "OTHER_CFLAGS": ["-fobjc-arc"]
            },
            "link_settings": {
              "libraries": [
                "-framework ApplicationServices",
                "-framework CoreFoundation"
              ]
            }
          }
        ]
      ]
    }
  ]
}
