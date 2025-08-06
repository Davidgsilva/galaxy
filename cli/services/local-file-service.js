const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class LocalFileService {
  constructor() {
    this.workingDir = process.cwd();
  }

  setWorkingDir(dir) {
    this.workingDir = path.resolve(dir);
  }

  getWorkingDir() {
    return this.workingDir;
  }

  resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.workingDir, filePath);
  }

  async createFile(filePath, content = '', options = {}) {
    try {
      const resolvedPath = this.resolvePath(filePath);

      // Check if file already exists
      if (await fs.pathExists(resolvedPath) && !options.overwrite) {
        throw new Error('File already exists');
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(resolvedPath));

      // Write file
      await fs.writeFile(resolvedPath, content, 'utf8');

      logger.info(`File created: ${resolvedPath}`);

      return {
        success: true,
        message: 'File created successfully',
        filePath: resolvedPath,
        size: content.length,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to create file ${filePath}:`, error);
      throw new Error(`File creation failed: ${error.message}`);
    }
  }

  async readFile(filePath, options = {}) {
    try {
      const resolvedPath = this.resolvePath(filePath);

      if (!await fs.pathExists(resolvedPath)) {
        throw new Error('File does not exist');
      }

      const stats = await fs.stat(resolvedPath);
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      const content = await fs.readFile(resolvedPath, 'utf8');

      return {
        success: true,
        files: [{
          path: resolvedPath,
          content,
          size: stats.size,
          modified: stats.mtime
        }],
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error);
      throw new Error(`File read failed: ${error.message}`);
    }
  }

  async updateFile(filePath, content, options = {}) {
    try {
      const resolvedPath = this.resolvePath(filePath);

      if (!await fs.pathExists(resolvedPath)) {
        throw new Error('File does not exist');
      }

      // Create backup if requested
      let backupPath = null;
      if (options.backup !== false) {
        backupPath = `${resolvedPath}.backup.${Date.now()}`;
        await fs.copy(resolvedPath, backupPath);
      }

      // Write updated content
      await fs.writeFile(resolvedPath, content, 'utf8');

      logger.info(`File updated: ${resolvedPath}`);

      return {
        success: true,
        message: 'File updated successfully',
        filePath: resolvedPath,
        backupPath,
        size: content.length,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to update file ${filePath}:`, error);
      throw new Error(`File update failed: ${error.message}`);
    }
  }

  async deleteFile(filePath, options = {}) {
    try {
      const resolvedPath = this.resolvePath(filePath);

      if (!await fs.pathExists(resolvedPath)) {
        throw new Error('File does not exist');
      }

      const stats = await fs.stat(resolvedPath);
      const isDirectory = stats.isDirectory();

      // Basic safety check for important files/directories
      if (!options.force) {
        const basename = path.basename(resolvedPath);
        const dangerous = ['.git', 'node_modules', 'package.json', 'package-lock.json'];
        if (dangerous.includes(basename)) {
          throw new Error(`Refusing to delete ${basename} without force option`);
        }
      }

      await fs.remove(resolvedPath);

      logger.info(`${isDirectory ? 'Directory' : 'File'} deleted: ${resolvedPath}`);

      return {
        success: true,
        message: `${isDirectory ? 'Directory' : 'File'} deleted successfully`,
        filePath: resolvedPath,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to delete ${filePath}:`, error);
      throw new Error(`File deletion failed: ${error.message}`);
    }
  }

  async listDirectory(dirPath = '.', options = {}) {
    try {
      const resolvedPath = this.resolvePath(dirPath);

      if (!await fs.pathExists(resolvedPath)) {
        throw new Error('Directory does not exist');
      }

      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error('Path is not a directory');
      }

      const items = [];

      if (options.recursive) {
        const pattern = options.showHidden ? '**/*' : '**/[!.]*';
        const matches = await glob(pattern, {
          cwd: resolvedPath,
          dot: options.showHidden,
          ignore: ['node_modules/**', '.git/**']
        });

        for (const match of matches) {
          const itemPath = path.join(resolvedPath, match);
          try {
            const itemStats = await fs.stat(itemPath);
            items.push({
              name: match,
              path: itemPath,
              type: itemStats.isDirectory() ? 'directory' : 'file',
              size: itemStats.size,
              modified: itemStats.mtime
            });
          } catch (error) {
            // Skip items that can't be accessed
          }
        }
      } else {
        const entries = await fs.readdir(resolvedPath);

        for (const entry of entries) {
          if (!options.showHidden && entry.startsWith('.')) continue;

          const itemPath = path.join(resolvedPath, entry);
          try {
            const itemStats = await fs.stat(itemPath);
            items.push({
              name: entry,
              path: itemPath,
              type: itemStats.isDirectory() ? 'directory' : 'file',
              size: itemStats.size,
              modified: itemStats.mtime
            });
          } catch (error) {
            // Skip items that can't be accessed
          }
        }
      }

      return {
        success: true,
        directory: resolvedPath,
        items: items.sort((a, b) => {
          // Directories first, then alphabetical
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        }),
        totalItems: items.length,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to list directory ${dirPath}:`, error);
      throw new Error(`Directory listing failed: ${error.message}`);
    }
  }

  async searchFiles(pattern, options = {}) {
    try {
      const searchDir = this.resolvePath(options.searchDir || '.');
      const recursive = options.recursive !== false;
      const maxFiles = options.maxFiles || 50;

      const globPattern = recursive ? `**/${pattern}` : pattern;
      const matches = await glob(globPattern, {
        cwd: searchDir,
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
        maxDepth: recursive ? undefined : 1
      });

      const files = [];
      for (const match of matches.slice(0, maxFiles)) {
        const filePath = path.join(searchDir, match);
        try {
          const stats = await fs.stat(filePath);
          if (stats.isFile() && stats.size < 1024 * 1024) { // Limit to 1MB files
            const content = await fs.readFile(filePath, 'utf8');
            files.push({
              path: filePath,
              content,
              size: stats.size,
              modified: stats.mtime
            });
          }
        } catch (error) {
          logger.warn(`Failed to read file: ${filePath}`, error);
        }
      }

      return {
        success: true,
        files,
        totalFiles: files.length,
        pattern,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to search files with pattern ${pattern}:`, error);
      throw new Error(`File search failed: ${error.message}`);
    }
  }

  async ensureDirectory(dirPath) {
    try {
      const resolvedPath = this.resolvePath(dirPath);
      await fs.ensureDir(resolvedPath);

      return {
        success: true,
        message: 'Directory ensured',
        dirPath: resolvedPath,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to ensure directory ${dirPath}:`, error);
      throw new Error(`Directory creation failed: ${error.message}`);
    }
  }

  async copyFile(sourcePath, destPath, options = {}) {
    try {
      const resolvedSource = this.resolvePath(sourcePath);
      const resolvedDest = this.resolvePath(destPath);

      if (!await fs.pathExists(resolvedSource)) {
        throw new Error('Source file does not exist');
      }

      await fs.copy(resolvedSource, resolvedDest, {
        overwrite: options.overwrite !== false
      });

      logger.info(`File copied: ${resolvedSource} -> ${resolvedDest}`);

      return {
        success: true,
        message: 'File copied successfully',
        sourcePath: resolvedSource,
        destPath: resolvedDest,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to copy file ${sourcePath} to ${destPath}:`, error);
      throw new Error(`File copy failed: ${error.message}`);
    }
  }

  async moveFile(sourcePath, destPath, options = {}) {
    try {
      const resolvedSource = this.resolvePath(sourcePath);
      const resolvedDest = this.resolvePath(destPath);

      if (!await fs.pathExists(resolvedSource)) {
        throw new Error('Source file does not exist');
      }

      await fs.move(resolvedSource, resolvedDest, {
        overwrite: options.overwrite !== false
      });

      logger.info(`File moved: ${resolvedSource} -> ${resolvedDest}`);

      return {
        success: true,
        message: 'File moved successfully',
        sourcePath: resolvedSource,
        destPath: resolvedDest,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to move file ${sourcePath} to ${destPath}:`, error);
      throw new Error(`File move failed: ${error.message}`);
    }
  }

  async getFileStats(filePath) {
    try {
      const resolvedPath = this.resolvePath(filePath);

      if (!await fs.pathExists(resolvedPath)) {
        throw new Error('File does not exist');
      }

      const stats = await fs.stat(resolvedPath);

      return {
        success: true,
        stats: {
          path: resolvedPath,
          size: stats.size,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          created: stats.birthtime,
          modified: stats.mtime,
          accessed: stats.atime
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error(`Failed to get stats for ${filePath}:`, error);
      throw new Error(`Get file stats failed: ${error.message}`);
    }
  }
}

module.exports = LocalFileService;