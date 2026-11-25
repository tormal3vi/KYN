// Runs before the app compiles: lets Tauri read tauri.conf.json and the
// capabilities/ folder and bake them into the binary.
fn main() {
    tauri_build::build()
}
