
(function(){
  ['olli_disabled_member_ids_v1','olli_member_role_overrides_v1','olli_member_device_status_overrides_v1'].forEach(function(key){
    try { localStorage.removeItem(key); } catch (error) {}
  });
  if (typeof GROUP_ICON_IMAGES === 'object' && GROUP_ICON_IMAGES) {
    Object.keys(GROUP_ICON_IMAGES).forEach(function(key){
      GROUP_ICON_IMAGES[key] = String(GROUP_ICON_IMAGES[key] || '').replace(/#CFCFD4/g, '%23CFCFD4');
    });
  }
})();
