#!/usr/bin/env node

/**
 * VIDEO TOOLKIT ALL-IN-ONE (RIZUMIYA)
 * Modularized for better maintainability and configurability.
 */

const inquirer = require("inquirer");
const chalk = require("chalk");
// require('dotenv').config(); // Legacy: Settings loaded via settings.json

// Modules
const { checkDependencies } = require("./src/utils/shell");
const { downloadAndCut } = require("./src/core/downloader");
const { multiFileCutAndMerge, mergeOnly, processHooksForFolder, mixExternalClips, rotateVideosToPortrait, compressVideos } = require("./src/core/processor");

const { getSettings, saveSettings } = require("./src/utils/settings_manager");

async function settingsMenu() {
  const currentSettings = getSettings();
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "gemini_api_key",
      message: "Gemini API Key (Wajib jika ingin menggunakan AI Hook - Caption Otomatis):",
      default: currentSettings.gemini_api_key
    },
    {
      type: "input",
      name: "source_folder",
      message: "Folder Sumber Video Default (Wajib):",
      default: currentSettings.source_folder
    },
    {
      type: "input",
      name: "backsound_folder",
      message: "Folder Backsound Default (Opsional):",
      default: currentSettings.backsound_folder
    },
    {
      type: "input",
      name: "trim_start",
      message: "Potong Awal Video Default (Opsional, e.g. 00:00:01):",
      default: currentSettings.trim_start
    },
    {
      type: "input",
      name: "trim_end",
      message: "Potong Akhir Video Default (Opsional, e.g. 00:00:05):",
      default: currentSettings.trim_end
    },
    {
      type: "number",
      name: "max_clips",
      message: "Jumlah Klip Maksimum per Video (Berapa banyak potongan yang akan diambil dari 1 video):",
      default: currentSettings.max_clips
    },
    {
      type: "input",
      name: "clip_duration",
      message: "Durasi per Klip (Detik, contoh: 2.5):",
      default: currentSettings.clip_duration
    }
  ]);

  if (saveSettings({ ...currentSettings, ...answers })) {
    console.log(chalk.green("\n✅ Pengaturan umum berhasil disimpan!"));
    console.log(chalk.gray("ℹ️  Pengaturan addon (seperti Repliz / TTS) dikelola lewat GUI -> Pengaturan -> Addons."));
  } else {
    console.log(chalk.red("\n❌ Gagal menyimpan pengaturan."));
  }
}

async function mainMenu() {
  // 1. Validasi Tools (FFmpeg, MP4Box, etc)
  await checkDependencies();

  while (true) {
    console.clear(); // Bersihkan layar setiap kali kembali ke menu utama
    console.log(chalk.green.bold("\n=================================================="));
    console.log(chalk.green.bold("        VIDEO TOOLKIT ALL-IN-ONE (RIZUMIYA)"));
    console.log(chalk.green.bold("=================================================="));


    const { choice } = await inquirer.prompt([
      {
        type: "list",
        name: "choice",
        message: "Pilih tugas yang ingin Anda lakukan:",
        choices: [
          { name: "1. Download & Potong Video (YouTube)", value: "download" },
          { name: "2. Potong & Gabung Multi-Video (Folder)", value: "batch" },
          { name: "3. Gabungkan Klip Saja (Langsung Jadi)", value: "merge" },
          { name: "4. Generator Hook AI (Folder)", value: "hooks" },
          { name: "5. Mix Clip External + Internal", value: "mix_external" },
          { name: "6. [Tools] Rotasi Video ke Portrait (-90°)", value: "rotate_portrait" },
          { name: "7. [Tools] Kompres Ukuran (Video & Audio)", value: "compress_video" },
          { name: "8. Pengaturan Umum", value: "settings" },
          new inquirer.Separator(),
          { name: "9. Buka Versi Web (GUI)", value: "gui" },
          { name: "10. Keluar", value: "exit" },
        ],
        pageSize: 10
      },
    ]);

    try {
      switch (choice) {
        case "download":
          await downloadAndCut();
          break;
        case "batch":
          await multiFileCutAndMerge();
          break;
        case "merge":
          await mergeOnly();
          break;
        case "hooks":
          await processHooksForFolder();
          break;
        case "mix_external":
          await mixExternalClips();
          break;
        case "rotate_portrait":
          await rotateVideosToPortrait();
          break;
        case "compress_video":
          await compressVideos();
          break;
        case "settings":
          await settingsMenu();
          break;
        case "gui":
          console.log(chalk.cyan("\n🌐 Memulai Video Toolkit GUI..."));
          console.log(chalk.yellow("Info: Browser akan otomatis terbuka."));
          console.log(chalk.gray("Tekan Ctrl+C untuk menutup aplikasi."));
          require("./src/server");
          // Infinite wait to keep server running without showing menu again immediately
          await new Promise(() => { });
          break;
        case "exit":
          console.log(chalk.magenta("\nTerima kasih! Sampai jumpa 👋 \n~ @rizumiya"));
          process.exit(0);
      }
    } catch (err) {
      console.error(chalk.red.bold("\n❌ Terjadi kesalahan:"), err.message);
    }


    await inquirer.prompt([
      { type: "input", name: "continue", message: "\nTekan Enter untuk kembali ke menu..." },
    ]);
  }
}

// Entry Point
mainMenu().catch(error => {
  console.error(chalk.red.bold('\n❌ Fatal Error:'), error.message);
  process.exit(1);
});