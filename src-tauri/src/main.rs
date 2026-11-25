// Stops Windows from opening an extra console window next to the app in
// release builds. Has no effect on macOS. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ghostline_lib::run()
}
