import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
const { ZipArchive } = require('archiver');

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const modelName = searchParams.get('modelName');

  if (!modelName) {
    return NextResponse.json({ error: 'modelName parameter is required' }, { status: 400 });
  }

  const safeModelName = modelName.replace(/\//g, "_");
  const modelFolder = path.join(process.cwd(), '..', 'commentary_analysis_system', 'data', 'output', `${safeModelName}_finetuned`, 'best');

  if (!fs.existsSync(modelFolder)) {
    return NextResponse.json({ error: 'Model directory not found. The model might not be trained yet.' }, { status: 404 });
  }
  
  const checkOnly = searchParams.get('checkOnly') === 'true';
  if (checkOnly) {
    return NextResponse.json({ exists: true }, { status: 200 });
  }

  const zipFilePath = path.join(process.cwd(), '..', 'commentary_analysis_system', 'data', 'output', `${safeModelName}_model.zip`);

  try {
    let needsZipping = true;
    if (fs.existsSync(zipFilePath)) {
      const modelStat = fs.statSync(modelFolder);
      const zipStat = fs.statSync(zipFilePath);
      // If the zip file is newer than the folder, we don't need to re-zip it!
      if (zipStat.mtimeMs > modelStat.mtimeMs && zipStat.size > 0) {
        needsZipping = false;
      } else {
        fs.unlinkSync(zipFilePath);
      }
    }

    if (needsZipping) {
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = new ZipArchive({
          zlib: { level: 5 }
        });

        output.on('close', () => {
          resolve();
        });

        archive.on('error', (err) => {
          reject(err);
        });

        archive.pipe(output);
        archive.directory(modelFolder, false);
        archive.finalize();
      });
    }

    const stats = fs.statSync(zipFilePath);
    
    // Instead of reading the whole file into memory, we stream it.
    // We create a standard readable stream from the node stream.
    const nodeStream = fs.createReadStream(zipFilePath);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(chunk));
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      }
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${safeModelName}_model.zip"`,
        'Content-Length': stats.size.toString()
      }
    });

  } catch (error) {
    console.error("Error zipping model:", error);
    return NextResponse.json({ error: 'Failed to create zip file' }, { status: 500 });
  }
}
