// ==UserScript==
// @name         Kumin Farm
// @author       Im Kumin
// @version      2.1.3
// @icon         https://cdn.myanimelist.net/s/common/userimages/99ae7797-2a6b-4ef6-b7da-c8d02dcd57ce_225w?s=69b58a93b7324d532b50383b191f5b8b
// @match        https://*/*screen=am_farm*
// @downloadURL  https://gistcdn.githack.com/ImKumin/7aafcda5a7ef73f771a42195fa786a41/raw/KuminFarm.user.js
// @updateURL    https://gistcdn.githack.com/ImKumin/7aafcda5a7ef73f771a42195fa786a41/raw/KuminFarm.user.js
// ==/UserScript==

$.ajax({
    type: "GET",
    url: 'https://gistcdn.githack.com/ImKumin/7aafcda5a7ef73f771a42195fa786a41/raw/KuminFarmLoaderT.js',
    dataType: "script",
    cache: false
});
