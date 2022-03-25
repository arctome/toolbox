import React, { useEffect, useState } from 'react';
import mammoth from 'mammoth'
import _ from 'lodash'
import { nanoid } from 'nanoid'
import { Upload, Button, Form, Input, Card, Switch, Divider, Col, Row, Select, message, Alert } from 'antd';
import { InboxOutlined, FolderOutlined } from '@ant-design/icons';
const { Dragger } = Upload;
// Styles
import './App.css';
// Node.js Modules
const ipcRenderer = window.require('electron').ipcRenderer
const fs = window.require('fs')

function App() {
  const [files, setFiles] = useState([])
  const [path, setPath] = useState('.')
  const [loading, setLoading] = useState(false)
  const [conf, setConf] = useState({
    styleMap: {
      bold: true, // "b => strong"
      italic: true, // "i => em"
      underline: true, // "u => ?"
      strikethrough: true, // "strike => s" ?
      comment: false, // "comment-reference => sup" ?
    },
    commonConvert: {
      numbering: false, // 1. => h4 || numbering !== null
      title: true, // fontSize > 12 || 一 => h2, （一） => h3, 
      keepCenter: true, // alignment === "center"
      keepIndent: true, // indent{keys} !== null
      convertMailToLink: true, // abc@xyz.com => <a href="mailto:abc@xyz.com">abc@xyz.com</a>
      convertLink: true, // http(s)://www.abc.com => <a href="http(s)://www.abc.com" target="_blank">http(s)://www.abc.com</a>
    },
    imageExecuter: "base64", // base64 || file || false
    injectStyle: {
      supportDarkMode: true, // add css `@media (prefers-color-scheme: dark)`
      imageMaxWidth: "100%", // 100% || exact-number-pixel || any css width text
      bodyMaxWidth: "100%", // 100% || exact-number-pixel || any css width text
    },
    config: {
      inlineInject: false, // inline inject will auto ignore `injectStyle.supportDarkMode`, because inline-style cannot be media query.
      rootFontSize: 12 // number of pixel
    }
  })

  // A very confusing feature, "五号" font size is equal to 10.5 pound (or pt).
  // Another useless knowledge, Chinese & Japanese version, Word default font size is 10.5pt.
  // Pretty tricky method to get default font-size, [Reference](https://www.msofficeforums.com/word/39239-disable-asian-font-comments-choose-latin-font.html)
  function __containHyperlink(item) {
    return /^http|https/.test(item.value)
  }
  function __containMailLink(item) {
    let pattern = /\@([A-Za-z0-9_\-\.])+\.([A-Za-z]{2,8})$/;
    return pattern.test(item.value)
  }
  function __containTitle(item) {
    let pattern1 = /^(\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u4e03|\u516b|\u4e5d|\u5341)+\u3001$/i // 一、
    let pattern2 = /^\uff08+(\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u4e03|\u516b|\u4e5d|\u5341)+\uff09/i // （一）
    let pattern3 = /^(\uff08|\()+([0-9])+(\uff09|\))/i // （1） or (1)
    if (pattern1.test(item.value)) {
      return 'l2'
    }
    if (pattern2.test(item.value)) {
      return 'l3'
    }
    if (pattern3.test(item.value)) {
      return 'l4'
    }
    return false
  }
  function __containListItem(item) {
    let pattern = /^([0-9])+\.$/i // 1.
    return pattern.test(item.value)
  }

  // during AST, add helper styleName.
  function transformElement(element) {
    if (element) {
      if (element.children) {
        let children = _.map(element.children, transformElement)
        element = { ...element, children: children }
      }
      // inject default value when AST parsing.
      if (element && element.type === "run" && element.fontSize === null) {
        element = { ...element, fontSize: 10.5 }
      }
      // inline elements
      if (element.type === "run" && element.children) {
        let containLink = element.children.find(item => __containHyperlink(item))
        let containMailLink = element.children.find(item => __containMailLink(item))
        if (containLink) {
          element = {
            anchor: undefined,
            children: [element],
            href: containLink.value,
            targetFrame: null,
            type: 'hyperlink'
          }
        }
        if (containMailLink) {
          element = {
            anchor: undefined,
            children: [element],
            href: 'mailto:' + containMailLink.value,
            targetFrame: null,
            type: 'hyperlink'
          }
        }
      }
      // block elements (p)
      if (element.type === "run" && element.children) {
        let exact = element.children.find(item => {
          return __containTitle(item) !== false
        })
        if (exact) {
          if (__containTitle(exact) === 'l2') {
            element = { ...element, styleName: '_CommonConvertTitle-l2' }
          }
          if (__containTitle(exact) === 'l3') {
            element = { ...element, styleName: '_CommonConvertTitle-l3' }
          }
          if (__containTitle(exact) === 'l4') {
            element = { ...element, styleName: '_CommonConvertTitle-l4' }
          }
        }
      }
      if (element.type === "run" && element.children) {
        let exact = element.children.find(item => __containListItem(item))
        if (exact) {
          element = { ...element, styleName: "_CommonConvertNumbering" }
        }
      }
      if (element.type === "paragraph") {
        element.children.map(item => {
          if (item.styleName && item.styleName.indexOf('_CommonConvertTitle-') > -1) {
            element = { ...element, styleName: item.styleName }
          }
          if (item.styleName && item.styleName === '_CommonConvertNumbering') {
            element = { ...element, styleName: item.styleName }
          }
        })
        if (element.alignment === "center") {
          element = { ...element, styleName: "_CommonConvertKeepCenter" }
        }
        if (element.indent.firstLine) {
          let em = Math.floor(parseInt(element.indent.firstLine) / 20 / (element.children[0] ? element.children[0].fontSize : conf.config.rootFontSize))
          element = { ...element, styleName: "_CommonConvertKeepIndent-l" + em }
        }
      }
    }
    return element
  }
  // after AST, generate mapping.
  function generateMapping() {
    let mapping = []
    let rules = {
      "!styleMap.bold": ["b => !"],
      "!styleMap.italic": ["i => !"],
      "!styleMap.underline": ["u => !"],
      "!styleMap.strikethrough": ["strike => !"],
      "!styleMap.comment": ["comment-reference => !"],
      "commonConvert.numbering": ["p[style-name='_CommonConvertNumbering'] => ul > li:fresh"],
      "commonConvert.title": [
        "p[style-name='_CommonConvertTitle-l2'] => h2:fresh",
        "p[style-name='_CommonConvertTitle-l3'] => h3:fresh",
        "p[style-name='_CommonConvertTitle-l4'] => h4:fresh"
      ],
      "commonConvert.keepCenter": ["p[style-name='_CommonConvertKeepCenter'] => p._inject-center"],
      "commonConvert.keepIndent": [
        "p[style-name='_CommonConvertKeepIndent-l1'] => p._inject-indent-l1",
        "p[style-name='_CommonConvertKeepIndent-l2'] => p._inject-indent-l2",
        "p[style-name='_CommonConvertKeepIndent-l3'] => p._inject-indent-l3",
        "p[style-name='_CommonConvertKeepIndent-l4'] => p._inject-indent-l4",
        "p[style-name='_CommonConvertKeepIndent-l5'] => p._inject-indent-l5",
        "p[style-name='_CommonConvertKeepIndent-l6'] => p._inject-indent-l6"
      ]
    }
    for (let i in conf.styleMap) {
      if (conf.styleMap[i] === false && rules["!styleMap." + i]) {
        mapping = mapping.concat(rules["!styleMap." + i])
      }
    }
    for (let k in conf.commonConvert) {
      if (conf.commonConvert[k] && rules["commonConvert." + k]) {
        mapping = mapping.concat(rules["commonConvert." + k])
      }
    }
    return mapping
  }
  // HTML generated, using pure HTML.
  function injectStyle2Head(originHTML, title) {
    let newHead = `
      <head>
        <title>${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <meta http-equiv="content-type" content="text/html; charset=UTF-8">
        <style>
          body{margin:0 auto;max-width: ${conf.injectStyle.bodyMaxWidth};font-size: ${conf.config.rootFontSize || 12}px;}
          img{display:block;max-width: ${conf.injectStyle.imageMaxWidth};}
          ${conf.commonConvert.keepIndent ? '._inject-center{text-align:center;}' : ''}
          ${conf.commonConvert.keepCenter ? '._inject-indent-l1{text-indent:1em;}' : ''}
          ${conf.injectStyle.supportDarkMode ? '@media screen and (prefers-color-scheme: dark) { body { background-color: #000; color: #fff;} }' : ''}
        </style>
      </head>
    `
    return `<html>${newHead}<body>${originHTML}</body></html>`
  }

  function covertExecuter() {
    let finishNum = 0
    if(!fs.existsSync(path + '/export')) {
      fs.mkdirSync(path+'/export')
    }
    if(!fs.existsSync(path+'/export/images') && conf.imageExecuter === "file") {
      fs.mkdirSync(path+'/export/images')
    }
    setLoading(true)
    for (let i in files) {
      let freader = new FileReader()
      freader.onload = function (e) {
        mammoth.convertToHtml({
          arrayBuffer: e.target.result,
        }, {
          transformDocument: element => transformElement(element),
          styleMap: generateMapping(),
          convertImage: mammoth.images.imgElement(function (image) {
            let imgName = image.altText || nanoid(6)
            let imgExt = image.contentType.replace('image/', '')
            if (conf.imageExecuter === "base64") {
              return image.read("base64").then(function (imgBuffer) {
                return {
                  src: "data:" + image.contentType + ";base64," + imgBuffer
                }
              })
            }
            if (conf.imageExecuter === "file") {
              return image.read("base64").then(function (imgBuffer) {
                fs.writeFile(`${path}/export/images/${imgName}.${imgExt}`, Buffer.from(imgBuffer, 'base64'), {
                  flag: 'w+'
                }, (e) => {
                  if (e) console.log(e)
                })
                return {
                  src: `${path}/export/images/${imgName}.${imgExt}`
                }
              })
            }
            return {}
          })
        })
          .then((result) => {
            let html = injectStyle2Head(result.value, files[i].name.replace(/.docx$/gi, '')) // The generated HTML
            fs.writeFile(`${path}/export/${files[i].name.replace(/.docx$/gi, '.html')}`, html, {
              encoding: 'utf8',
              flag: 'w'
            }, (e) => {
              if(e) console.log(e)
            })
          })
          .done(e => {
            // freader = null
            finishNum += 1
            if (finishNum === files.length) {
              message.success(`共计${files.length}个文件转换成功！`)
              setFiles([])
            }
            setLoading(false)
          })
      }
      freader.readAsArrayBuffer(files[i])
    }
  }

  // propStr = "imageExecuter" || "config.rootFontSize"
  function changeConfigHandler(propStr, value) {
    let newConf = JSON.parse(JSON.stringify(conf))
    let props = propStr.split('.')
    if (props.length === 1) {
      newConf[props[0]] = value
      setConf(newConf)
      return
    } else {
      newConf[props[0]][props[1]] = value
      setConf(newConf)
      return
    }
  }

  // Dragger props
  const props = {
    name: 'file',
    multiple: true,
    beforeUpload: (file) => {
      if (file.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        if (file.type === 'application/msword') {
          message.warn('很遗憾目前暂不支持旧版.doc文件！')
          return false
        }
        message.error(`"${file.name}"` + '不是有效的Word文件！')
        return false
      }
      let checkExist = files.find(item => {
        return item.name === file.name
      })
      if (checkExist) {
        message.error('添加同名文件，请移除原有文件后再添加！')
        return false
      }
      files.push(file)
      let newFiles = files.slice(0)
      setFiles(newFiles)
      return false
    },
    id: 'holder',
    fileList: files,
    onRemove: (item) => {
      let delIdx = files.findIndex(i => {
        return item.uid === i.uid
      })
      files.splice(delIdx, 1)
      let newFiles = files.slice(0)
      setFiles(newFiles)
    }
  }

  // Output path selector
  function outputPathHandler() {
    ipcRenderer.send('open-directory-dialog', 'openDirectory')
  }

  useEffect(() => {
    ipcRenderer.on('selected-item', function(event, data) {
      let path = data.filePaths[0]
      setPath(path)
    })
  }, [])

  return (
    <div className="App">
      <Dragger {...props}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">选择文件</p>
        <p className="ant-upload-hint">
          请将需要转换的.doc/.docx文件拖放至此 或 点击此区域在打开的窗体中选择文件，支持单文件或多文件。
        </p>
      </Dragger>
      <section style={{ display: "flex", justifyContent: "space-between" }}>
        <Button type="primary" disabled={files.length < 1} onClick={() => covertExecuter()} loading={loading}>
          {loading ? '正在转换...' : '开始转换'}
        </Button>
        <Input.Group compact style={{display: "inline-block", width: "auto"}}>
          <Input value={path} readOnly style={{width: "400px"}} />
          <Button type="text" onClick={() => outputPathHandler()}><FolderOutlined /></Button>
        </Input.Group>
      </section>
      <div className="config-area">
        <Divider plain><span style={{ fontSize: "16px", fontWeight: 700 }}>转换选项</span></Divider>
        <Row gutter={16}>
          <Col span={8}>
            <Card title="文字样式">
              <Form>
                <Form.Item label="保留“粗体”"><Switch defaultChecked={conf.styleMap.bold} onChange={(bool) => changeConfigHandler('styleMap.bold', bool)} /></Form.Item>
                <Form.Item label="保留“斜体”"><Switch defaultChecked={conf.styleMap.italic} onChange={(bool) => changeConfigHandler('styleMap.italic', bool)} /></Form.Item>
                <Form.Item label="保留“下划线”"><Switch defaultChecked={conf.styleMap.underline} onChange={(bool) => changeConfigHandler('styleMap.underline', bool)} /></Form.Item>
                <Form.Item label="保留“中划线”"><Switch defaultChecked={conf.styleMap.strikethrough} onChange={(bool) => changeConfigHandler('styleMap.strikethrough', bool)} /></Form.Item>
                <Form.Item label="保留“评论”"><Switch defaultChecked={conf.styleMap.comment} onChange={(bool) => changeConfigHandler('styleMap.comment', bool)} /></Form.Item>
              </Form>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="常用转换">
              <Form>
                <Form.Item label="转换序号" tooltip="转换形如“1.”，“1、”的序号为列表项"><Switch defaultChecked={conf.commonConvert.numbering} disabled onChange={(bool) => changeConfigHandler('commonConvert.numbering', bool)} /></Form.Item>
                <Form.Item label="转换标题" tooltip="转换形如“一、”，“（一）”的序号为对应层级标题"><Switch defaultChecked={conf.commonConvert.title} onChange={(bool) => changeConfigHandler('commonConvert.title', bool)} /></Form.Item>
                <Form.Item label="保留居中"><Switch defaultChecked={conf.commonConvert.keepCenter} onChange={(bool) => changeConfigHandler('commonConvert.keepCenter', bool)} /></Form.Item>
                <Form.Item label="保留缩进" tooltip="首行缩进，根据fontSize动态计算"><Switch defaultChecked={conf.commonConvert.keepIndent} onChange={(bool) => changeConfigHandler('commonConvert.keepIndent', bool)} /></Form.Item>
                <Form.Item label="自动转换链接" tooltip="转换以“http”或“https”开头的内容"><Switch defaultChecked={conf.commonConvert.convertLink} onChange={(bool) => changeConfigHandler('commonConvert.convertLink', bool)} /></Form.Item>
                <Form.Item label="自动转换邮箱" tooltip="转换包含@domain.xxx的邮箱地址"><Switch defaultChecked={conf.commonConvert.convertMailToLink} onChange={(bool) => changeConfigHandler('commonConvert.convertMailToLink', bool)} /></Form.Item>
              </Form>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="样式注入">
              <Form>
                <Form.Item label="支持“深色模式”"><Switch defaultChecked={conf.injectStyle.supportDarkMode} onChange={(bool) => changeConfigHandler('injectStyle.supportDarkMode', bool)} /></Form.Item>
                <Form.Item label="图片最大宽度"><Input defaultValue={conf.injectStyle.imageMaxWidth} onChange={(val) => changeConfigHandler('injectStyle.imageMaxWidth', val)} /></Form.Item>
                <Form.Item label="body宽度"><Input defaultValue={conf.injectStyle.bodyMaxWidth} onChange={(val) => changeConfigHandler('injectStyle.bodyMaxWidth', val)} /></Form.Item>
              </Form>
            </Card>
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: "10px" }}>
          <Col span={12}>
            <Card title="图片处理">
              <Form>
                <Form.Item label="处理方式" tooltip={
                  <aside>
                    <p>Base64: 直接将图片转换为base64, 如果图片过大可能影响HTML大小;</p>
                    <p>提取: 将所有图片导出为对应的文件;</p>
                    <p>忽略: 跳过文档内所有图片;</p>
                  </aside>
                }>
                  <Select defaultValue={conf.imageExecuter} onChange={(val) => changeConfigHandler('imageExecuter', val)}>
                    <Select.Option value="base64">使用Base64转换图片</Select.Option>
                    <Select.Option value="file">提取到目录下的“/image”内</Select.Option>
                    <Select.Option value={false}>忽略所有图片</Select.Option>
                  </Select>
                  {conf.imageExecuter === "file" ? <Alert message="如果选择提取文件，可能会产生覆盖！" type="warning" showIcon style={{ marginTop: "10px" }} /> : ''}
                </Form.Item>
              </Form>
            </Card>
          </Col>
          <Col span={12}>
            <Card title="设置">
              <Form>
                <Form.Item label="行内注入" tooltip="将样式写入行内，适用于部分特殊场景"><Switch disabled={true} defaultChecked={conf.config.inlineInject} onChange={(bool) => changeConfigHandler('config.inlineInject', bool)} /></Form.Item>
                <Form.Item label="根节点字号" tooltip="正文的CSS字号大小，其他元素会根据此动态变化"><Input defaultValue={conf.config.rootFontSize} onChange={(val) => changeConfigHandler('config.rootFontSize', val)} /></Form.Item>
              </Form>
            </Card>
          </Col>
        </Row>
      </div>
    </div>
  );
}

export default App;
