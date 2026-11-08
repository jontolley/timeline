Pod::Spec.new do |s|
  s.name           = 'HindsitePlaces'
  s.version        = '1.0.0'
  s.summary        = 'Apple Maps place search for the Hindsite app'
  s.description    = 'Searches places with MapKit (MKLocalSearch), centred on a point, for the event form place picker.'
  s.license        = 'UNLICENSED'
  s.author         = 'Hindsite'
  s.homepage       = 'https://hindsite.app'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'MapKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
