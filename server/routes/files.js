const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const path = require('path');
const { glob } = require('glob');
const AnthropicService = require('../services/anthropic');
const CacheService = require('../services/cache');
const { validateFileRequest } = require('../middleware/validation');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()]
});

// Create file with AI assistance
router.post('/create', validateFileRequest, async (req, res) => {
  try {
    const { filePath, content, prompt, useAI = true } = req.body;

    // Security check - ensure path is within allowed directories
    const resolvedPath = path.resolve(filePath);
    if (!isPathSafe(resolvedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Security Error',
        message: 'File path is not allowed'
      });
    }

    // Check if file already exists
    if (await fs.pathExists(resolvedPath)) {
      return res.status(409).json({
        success: false,
        error: 'File Exists',
        message: 'File already exists'
      });
    }

    let fileContent = content;

    // Use AI to generate content if prompt is provided and no content
    if (useAI && prompt && !content) {
      const systemPrompt = `You are a helpful assistant that creates file content based on user requirements. 
      Create appropriate content for the file "${filePath}" based on the user's prompt. 
      Return only the file content, no explanations or markdown formatting.`;

      const response = await AnthropicService.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      fileContent = response.content[0].text;
    }

    // Ensure directory exists
    await fs.ensureDir(path.dirname(resolvedPath));

    // Write file
    await fs.writeFile(resolvedPath, fileContent || '', 'utf8');

    logger.info('File created successfully', { filePath: resolvedPath });

    res.json({
      success: true,
      message: 'File created successfully',
      filePath: resolvedPath,
      size: fileContent ? fileContent.length : 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('File creation error:', error);
    res.status(500).json({
      success: false,
      error: 'File Creation Error',
      message: error.message
    });
  }
});

// Read file(s) with optional AI analysis
router.get('/read', async (req, res) => {
  try {
    const { filePath, pattern, analyze, recursive = false, maxFiles = 50 } = req.query;

    let filePaths = [];

    if (filePath) {
      // Single file
      const resolvedPath = path.resolve(filePath);
      if (!isPathSafe(resolvedPath)) {
        return res.status(403).json({
          success: false,
          error: 'Security Error',
          message: 'File path is not allowed'
        });
      }

      if (!await fs.pathExists(resolvedPath)) {
        return res.status(404).json({
          success: false,
          error: 'File Not Found',
          message: 'File does not exist'
        });
      }

      filePaths = [resolvedPath];
    } else if (pattern) {
      // Pattern matching
      const globPattern = recursive ? `**/${pattern}` : pattern;
      const matches = await glob(globPattern, {
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
        maxDepth: recursive ? undefined : 1
      });

      filePaths = matches
        .slice(0, maxFiles)
        .map(p => path.resolve(p))
        .filter(p => isPathSafe(p));
    } else {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'Either filePath or pattern is required'
      });
    }

    if (filePaths.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No Files Found',
        message: 'No files match the specified criteria'
      });
    }

    // Read files
    const files = [];
    for (const fp of filePaths) {
      try {
        const stats = await fs.stat(fp);
        if (stats.isFile() && stats.size < 1024 * 1024) { // Limit to 1MB files
          const content = await fs.readFile(fp, 'utf8');
          files.push({
            path: fp,
            content,
            size: stats.size,
            modified: stats.mtime
          });
        }
      } catch (error) {
        logger.warn(`Failed to read file: ${fp}`, error);
      }
    }

    let analysis = null;

    // Perform AI analysis if requested
    if (analyze && files.length > 0) {
      const analysisPrompt = buildAnalysisPrompt(files, analyze);
      
      try {
        const response = await AnthropicService.createMessage({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          temperature: 0.1,
          system: 'You are a code analysis expert. Provide detailed and actionable insights.',
          messages: [{
            role: 'user',
            content: analysisPrompt
          }]
        });

        analysis = response.content[0].text;
      } catch (error) {
        logger.error('Analysis error:', error);
        analysis = 'Analysis failed: ' + error.message;
      }
    }

    res.json({
      success: true,
      files: files.map(f => ({
        path: f.path,
        content: f.content,
        size: f.size,
        modified: f.modified
      })),
      analysis,
      totalFiles: files.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('File read error:', error);
    res.status(500).json({
      success: false,
      error: 'File Read Error',
      message: error.message
    });
  }
});

// Update file with AI assistance
router.put('/update', validateFileRequest, async (req, res) => {
  try {
    const { filePath, instruction, content, createBackup = true } = req.body;

    const resolvedPath = path.resolve(filePath);
    if (!isPathSafe(resolvedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Security Error',
        message: 'File path is not allowed'
      });
    }

    if (!await fs.pathExists(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: 'File Not Found',
        message: 'File does not exist'
      });
    }

    // Create backup if requested
    let backupPath = null;
    if (createBackup) {
      backupPath = `${resolvedPath}.backup.${Date.now()}`;
      await fs.copy(resolvedPath, backupPath);
    }

    let newContent = content;

    // Use AI to generate updated content if instruction is provided
    if (instruction && !content) {
      const currentContent = await fs.readFile(resolvedPath, 'utf8');
      
      const systemPrompt = `You are a helpful assistant that updates file content based on user instructions.
      You will be given the current file content and instructions for how to modify it.
      Return only the updated file content, no explanations or markdown formatting.
      Preserve the existing structure and style unless specifically asked to change it.`;

      const userPrompt = `Current file content:\n\n${currentContent}\n\nInstructions: ${instruction}`;

      const response = await AnthropicService.createMessage({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: userPrompt
        }]
      });

      newContent = response.content[0].text;
    }

    // Write updated content
    await fs.writeFile(resolvedPath, newContent, 'utf8');

    logger.info('File updated successfully', { 
      filePath: resolvedPath,
      backupPath,
      hasInstruction: !!instruction
    });

    res.json({
      success: true,
      message: 'File updated successfully',
      filePath: resolvedPath,
      backupPath,
      size: newContent.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('File update error:', error);
    res.status(500).json({
      success: false,
      error: 'File Update Error',
      message: error.message
    });
  }
});

// Delete file with AI safety check
router.delete('/delete', async (req, res) => {
  try {
    const { filePath, skipSafetyCheck = false } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error',
        message: 'filePath is required'
      });
    }

    const resolvedPath = path.resolve(filePath);
    if (!isPathSafe(resolvedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Security Error',
        message: 'File path is not allowed'
      });
    }

    if (!await fs.pathExists(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: 'File Not Found',
        message: 'File does not exist'
      });
    }

    const stats = await fs.stat(resolvedPath);
    const isDirectory = stats.isDirectory();

    let safetyAnalysis = null;

    // Perform AI safety check unless skipped
    if (!skipSafetyCheck) {
      const itemType = isDirectory ? 'directory' : 'file';
      const safetyPrompt = `Analyze the safety of deleting this ${itemType}: "${resolvedPath}"
      
      Consider:
      - Is this a system or important configuration file?
      - Could deletion cause significant problems?
      - Is this likely to contain important data?
      - Are there any red flags about deleting this item?
      
      Respond with:
      1. SAFE or UNSAFE
      2. Brief explanation of your reasoning
      3. Recommended action`;

      try {
        const response = await AnthropicService.createMessage({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          temperature: 0.1,
          system: 'You are a safety expert analyzing file deletion requests. Be conservative and prioritize data safety.',
          messages: [{
            role: 'user',
            content: safetyPrompt
          }]
        });

        safetyAnalysis = response.content[0].text;
      } catch (error) {
        logger.error('Safety analysis error:', error);
        safetyAnalysis = 'Safety analysis failed - proceeding with caution';
      }
    }

    // Check if AI analysis suggests it's unsafe
    if (safetyAnalysis && safetyAnalysis.toUpperCase().includes('UNSAFE')) {
      return res.status(400).json({
        success: false,
        error: 'Safety Check Failed',
        message: 'AI safety analysis suggests this deletion may be unsafe',
        safetyAnalysis,
        recommendation: 'Review the analysis and use skipSafetyCheck=true if you want to proceed'
      });
    }

    // Perform deletion
    await fs.remove(resolvedPath);

    logger.info('File deleted successfully', { 
      filePath: resolvedPath,
      isDirectory,
      safetyCheckPerformed: !skipSafetyCheck
    });

    res.json({
      success: true,
      message: `${isDirectory ? 'Directory' : 'File'} deleted successfully`,
      filePath: resolvedPath,
      safetyAnalysis,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'File Deletion Error',
      message: error.message
    });
  }
});

// List directory contents
router.get('/list', async (req, res) => {
  try {
    const { dirPath = '.', showHidden = false, recursive = false } = req.query;

    const resolvedPath = path.resolve(dirPath);
    if (!isPathSafe(resolvedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Security Error',
        message: 'Directory path is not allowed'
      });
    }

    if (!await fs.pathExists(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: 'Directory Not Found',
        message: 'Directory does not exist'
      });
    }

    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: 'Not a Directory',
        message: 'Path is not a directory'
      });
    }

    const items = [];
    
    if (recursive) {
      const pattern = showHidden ? '**/*' : '**/[!.]*';
      const matches = await glob(pattern, {
        cwd: resolvedPath,
        dot: showHidden,
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
        if (!showHidden && entry.startsWith('.')) continue;
        
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

    res.json({
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
    });

  } catch (error) {
    logger.error('Directory listing error:', error);
    res.status(500).json({
      success: false,
      error: 'Directory Listing Error',
      message: error.message
    });
  }
});

// Helper functions
function isPathSafe(filePath) {
  // Basic security checks
  const resolved = path.resolve(filePath);
  
  // Don't allow access to system directories
  const forbidden = ['/etc', '/root', '/proc', '/sys', '/dev'];
  if (forbidden.some(dir => resolved.startsWith(dir))) {
    return false;
  }

  // Don't allow parent directory traversal
  if (resolved.includes('..')) {
    return false;
  }

  return true;
}

function buildAnalysisPrompt(files, analysisType) {
  let prompt = `Please analyze the following ${files.length} file(s):\n\n`;
  
  files.forEach((file, index) => {
    prompt += `File ${index + 1}: ${file.path}\n`;
    prompt += `Content:\n${file.content}\n\n`;
  });

  switch (analysisType.toLowerCase()) {
    case 'security':
      prompt += 'Focus on security vulnerabilities, potential exploits, and security best practices.';
      break;
    case 'performance':
      prompt += 'Focus on performance issues, optimization opportunities, and efficiency improvements.';
      break;
    case 'style':
      prompt += 'Focus on code style, formatting, naming conventions, and maintainability.';
      break;
    case 'bugs':
      prompt += 'Focus on potential bugs, logic errors, and correctness issues.';
      break;
    default:
      prompt += `Focus on ${analysisType} analysis.`;
  }

  return prompt;
}

module.exports = router;