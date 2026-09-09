const path = require('path');

module.exports = {
  entry: {
    user: './public/js/user.js',
    producer: './public/js/producer.js',
    output: './public/js/output.js',
    helper: './public/js/helper.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist/js'),
    filename: '[name].bundle.js',
    clean: true
  },
  mode: 'production',
  module: {
    parser: {
      javascript: { sourceType: 'module' }
    },
    rules: [
      {
        test: /\.m?js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            sourceType: 'module',
            presets: [
              [
                '@babel/preset-env',
                {
                  targets: {
                    browsers: ['defaults']
                  },
                  modules: 'commonjs'
                }
              ]
            ]
          }
        }
      }
    ]
  },
  target: ['web', 'es2020'],
  resolve: {
    extensions: ['.js']
  },
  experiments: {
    topLevelAwait: true
  }
};


