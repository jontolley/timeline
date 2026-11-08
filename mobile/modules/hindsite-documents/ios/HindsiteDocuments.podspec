Pod::Spec.new do |s|
  s.name           = 'HindsiteDocuments'
  s.version        = '1.0.0'
  s.summary        = 'Document scanning and PDF building for the Hindsite app'
  s.description    = 'Scan pages with VisionKit, combine images into a PDF and read a PDF page count and first page with PDFKit.'
  s.license        = 'UNLICENSED'
  s.author         = 'Hindsite'
  s.homepage       = 'https://hindsite.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PDFKit', 'VisionKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
