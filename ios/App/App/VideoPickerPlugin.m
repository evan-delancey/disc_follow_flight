#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Registers the VideoPickerPlugin with Capacitor so it is accessible from
// JavaScript as window.Capacitor.Plugins.VideoPickerPlugin
CAP_PLUGIN(VideoPickerPlugin, "VideoPickerPlugin",
    CAP_PLUGIN_METHOD(pickFromLibrary, CAPPluginReturnPromise);
)
